import {
  buildDiscussionStagePrompt,
  type DiscussionMode,
  parseDiscussionRequest,
  selectCoordinatorIndex,
} from '@agentroom/shared'
import { NextRequest } from 'next/server'

import { buildInitialAgentRunRows } from '@/lib/agent-runs'
import { selectTargetAgents } from '@/lib/agent-targeting'
import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { sendMessageSchema } from '@/lib/api-validation'
import { parseMentions } from '@/lib/mention-parser'
import { requireRoomMember, requireRoomOwner } from '@/lib/permissions'
import { clearRoomChat } from '@/lib/room-chat-management'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams {
  params: { roomId: string }
}

type AgentMemberRow = {
  agent_id: string
  agents: {
    id: string
    slug: string
    name: string
    provider: string
    capabilities: string | null
    is_active: boolean
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params

  // 0. CSRF defense for cookie-authed mutations.
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  // 1. Authenticate
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  // 1b. Rate limit: each message can fan out N subprocess runs, so throttle hard.
  const limited = enforceRateLimit(`message:${user.id}:${roomId}`, 30, 60_000)
  if (limited) return limited

  // 2. Verify room membership
  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomMember(supabase, roomId, user.id)
  } catch (e) {
    return e as Response
  }

  // 3. Parse body
  const body = await req.json().catch(() => null)
  const parseResult = sendMessageSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const data = parseResult.data
  const rawContent = data.content.trim()
  const discussionRequest = parseDiscussionRequest(rawContent)
  // ADR-0011: a discussion kicks off at the 'plan' phase on a single coordinator agent (not a
  // blind parallel fan-out). The coordinator decomposes the problem; the bridge orchestrator
  // then drives execute → integrate → [dissent] → converge.
  const content = discussionRequest
    ? buildDiscussionStagePrompt(discussionRequest.command, 'plan', discussionRequest.prompt)
    : rawContent
  if (!content) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, {
      fieldErrors: { content: ['content is required'] },
    })
  }
  if (discussionRequest && !discussionRequest.prompt) {
    return apiError(
      'VALIDATION_ERROR',
      'Use /discuss followed by the problem you want agents to solve together.',
      400,
    )
  }

  const roundIndex = data.round_index ?? 0
  const hopIndex = data.hop_index ?? 0

  // 4. Fetch room for reply_mode and loop guard limits
  const { data: room } = await supabase
    .from('rooms')
    .select(
      'id, reply_mode, max_agent_rounds, max_agent_hops, allow_agent_to_agent, discussion_mode',
    )
    .eq('id', roomId)
    .single()

  if (!room) return apiError('NOT_FOUND', 'Room not found', 404)

  // 5. Insert message
  const initialMetadata = {
    ...(data.metadata ?? {}),
    ...(discussionRequest
      ? {
          discussion: {
            enabled: true,
            command: discussionRequest.command,
            phase: 'plan',
            original_prompt: discussionRequest.prompt,
          },
        }
      : {}),
  }

  const { data: message, error: msgErr } = await supabase
    .from('messages')
    .insert({
      room_id: roomId,
      sender_type: 'user',
      sender_user_id: user.id,
      content,
      content_type: data.content_type ?? 'text',
      reply_to_id: data.reply_to_id ?? null,
      mentions: data.mentions ?? [],
      target_agent_ids: data.target_agent_ids ?? [],
      round_index: roundIndex,
      metadata: initialMetadata,
    })
    .select()
    .single()

  if (msgErr || !message) return internalError('messages insert', msgErr)

  const rawFileIds = (data.metadata as { file_ids?: unknown } | undefined)?.file_ids
  const fileIds = Array.isArray(rawFileIds)
    ? rawFileIds.filter((id): id is string => typeof id === 'string')
    : []
  if (fileIds.length > 0) {
    await supabase
      .from('files')
      .update({ message_id: message.id, metadata: { upload_status: 'attached' } })
      .in('id', fileIds)
      .eq('room_id', roomId)
  }

  // NOTE: the discussion metadata is finalized below (after the coordinator is picked) so
  // original_message_id + coordinator_agent_id are written in a single patch.

  // 6. Update room.last_message_at
  await supabase.from('rooms').update({ last_message_at: message.created_at }).eq('id', roomId)

  const insertSystemMessage = (content: string) =>
    supabase.from('messages').insert({
      room_id: roomId,
      sender_type: 'system',
      content,
      content_type: 'text',
      mentions: [],
      target_agent_ids: [],
      round_index: roundIndex,
    })

  // 7. Loop guard
  const maxRounds = (room as { max_agent_rounds: number }).max_agent_rounds
  const maxHops = (room as { max_agent_hops: number }).max_agent_hops
  const discussionMode =
    (room as { discussion_mode?: DiscussionMode }).discussion_mode ?? 'independent'

  if (roundIndex >= maxRounds) {
    await insertSystemMessage(`Loop guard: agent discussion stopped after ${maxRounds} rounds.`)
    return apiSuccess({ message, agent_runs: [] }, 201)
  }

  if (hopIndex >= maxHops) {
    await insertSystemMessage(`Loop guard: agent chain stopped after ${maxHops} hops.`)
    return apiSuccess({ message, agent_runs: [] }, 201)
  }

  // 8. Find active, unmuted agents with reply_enabled=true
  const { data: rawMembers } = await supabase
    .from('room_members')
    .select('agent_id, agents!inner(id, slug, name, provider, capabilities, is_active)')
    .eq('room_id', roomId)
    .eq('member_type', 'agent')
    .eq('reply_enabled', true)
    .eq('muted', false)

  const allActive = ((rawMembers ?? []) as unknown as AgentMemberRow[]).filter(
    (m) => m.agents?.is_active,
  )

  // 9. Mention-based routing
  const mentions = parseMentions(
    rawContent,
    allActive.map((m) => m.agents),
  )
  const replyMode = (room as { reply_mode: string }).reply_mode

  let targetAgents: Array<{ agent_id: string }>
  let systemMessage: string | undefined

  if (discussionRequest) {
    // ADR-0011: the 'plan' phase runs on ONE deterministically-chosen coordinator (no blind
    // parallel fan-out). The coordinator decomposes + assigns; the bridge orchestrator drives
    // the rest. Finalize the discussion metadata now that the coordinator is known.
    const coordIdx = selectCoordinatorIndex(
      allActive.map((m) => ({
        slug: m.agents.slug,
        provider: m.agents.provider,
        capabilities: m.agents.capabilities,
      })),
    )
    const coordinator = coordIdx >= 0 ? allActive[coordIdx] : undefined
    if (!coordinator) {
      await insertSystemMessage('No active agents are available to start a discussion.')
      return apiSuccess({ message, agent_runs: [] }, 201)
    }
    targetAgents = [{ agent_id: coordinator.agent_id }]
    const nextMetadata = {
      ...initialMetadata,
      discussion: {
        ...(initialMetadata.discussion as Record<string, unknown>),
        original_message_id: message.id,
        coordinator_agent_id: coordinator.agent_id,
      },
    }
    await supabase.from('messages').update({ metadata: nextMetadata }).eq('id', message.id)
    message.metadata = nextMetadata
  } else {
    const selected = selectTargetAgents({
      allActive,
      mentions,
      replyMode,
      isDiscussionRequest: false,
    })
    targetAgents = selected.targetAgents
    systemMessage = selected.systemMessage
  }

  if (systemMessage) {
    await insertSystemMessage(systemMessage)
    return apiSuccess({ message, agent_runs: [] }, 201)
  }

  // 10. Create one agent_run per qualifying agent (discussion: a single coordinator run)
  const agentRuns: unknown[] = []
  if (targetAgents.length > 0) {
    const runDiscussionMode: DiscussionMode = discussionRequest ? 'tag_turns' : discussionMode
    const runs = buildInitialAgentRunRows({
      roomId,
      messageId: message.id,
      targetAgents,
      roundIndex,
      discussionMode: runDiscussionMode,
    })

    const { data: insertedRuns } = await supabase.from('agent_runs').insert(runs).select()

    if (insertedRuns) agentRuns.push(...insertedRuns)
  }

  return apiSuccess({ message, agent_runs: agentRuns }, 201)
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomOwner(supabase, roomId, user.id)
    await clearRoomChat(supabase, roomId)
  } catch (e) {
    if (e instanceof Response) return e
    return internalError('messages clear chat', e)
  }

  return apiSuccess({ cleared: true })
}
