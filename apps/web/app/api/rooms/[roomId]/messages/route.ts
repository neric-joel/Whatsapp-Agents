import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { sendMessageSchema } from '@/lib/api-validation'
import { requireRoomMember, requireRoomOwner } from '@/lib/permissions'
import { clearRoomChat } from '@/lib/room-chat-management'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'
import { parseMentions } from '@/lib/mention-parser'
import { buildDiscussionPhasePrompt, parseDiscussionCommand } from '@agentroom/shared'

interface RouteParams { params: { roomId: string } }

type AgentMemberRow = {
  agent_id: string
  agents: { id: string; slug: string; name: string; is_active: boolean }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params

  // 1. Authenticate
  const { data: { user }, error: authErr } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

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
  const discussionCommand = parseDiscussionCommand(rawContent)
  const content = discussionCommand
    ? buildDiscussionPhasePrompt('individual', discussionCommand.prompt)
    : rawContent
  if (!content) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, { fieldErrors: { content: ['content is required'] } })
  }
  if (discussionCommand && !discussionCommand.prompt) {
    return apiError('VALIDATION_ERROR', 'Use /discuss followed by the problem you want agents to solve together.', 400)
  }

  const roundIndex = data.round_index ?? 0
  const hopIndex = data.hop_index ?? 0

  // 4. Fetch room for reply_mode and loop guard limits
  const { data: room } = await supabase
    .from('rooms')
    .select('id, reply_mode, max_agent_rounds, max_agent_hops, allow_agent_to_agent')
    .eq('id', roomId)
    .single()

  if (!room) return apiError('NOT_FOUND', 'Room not found', 404)

  // 5. Insert message
  const initialMetadata = {
    ...(data.metadata ?? {}),
    ...(discussionCommand
      ? {
          discussion: {
            enabled: true,
            command: discussionCommand.command,
            phase: 'individual',
            original_prompt: discussionCommand.prompt,
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

  if (msgErr || !message) return apiError('INTERNAL_ERROR', msgErr?.message ?? 'Failed to insert message', 500)

  if (discussionCommand) {
    const nextMetadata = {
      ...initialMetadata,
      discussion: {
        ...(initialMetadata.discussion as Record<string, unknown>),
        original_message_id: message.id,
      },
    }
    await supabase.from('messages').update({ metadata: nextMetadata }).eq('id', message.id)
    message.metadata = nextMetadata
  }

  // 6. Update room.last_message_at
  await supabase
    .from('rooms')
    .update({ last_message_at: message.created_at })
    .eq('id', roomId)

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
    .select('agent_id, agents!inner(id, slug, name, is_active)')
    .eq('room_id', roomId)
    .eq('member_type', 'agent')
    .eq('reply_enabled', true)
    .eq('muted', false)

  const allActive = ((rawMembers ?? []) as unknown as AgentMemberRow[]).filter(
    (m) => m.agents?.is_active
  )

  // 9. Mention-based routing
  const mentions = parseMentions(rawContent, allActive.map((m) => m.agents))
  const replyMode = (room as { reply_mode: string }).reply_mode

  let targetAgents = allActive

  if (discussionCommand) {
    targetAgents = allActive
  } else if (replyMode === 'mentioned_only') {
    if (mentions.length === 0) {
      await insertSystemMessage('No agents were mentioned. Use @agent_slug or @everyone.')
      return apiSuccess({ message, agent_runs: [] }, 201)
    }
    const hasEveryone = mentions.some((m) => m.type === 'everyone')
    if (!hasEveryone) {
      const ids = new Set(mentions.filter((m) => m.type === 'agent').map((m) => m.agent_id))
      targetAgents = allActive.filter((m) => ids.has(m.agent_id))
    }
  }
  // 'everyone' / 'smart' / other → all active agents (no change)

  // 10. Create one agent_run per qualifying agent
  const agentRuns: unknown[] = []
  if (targetAgents.length > 0) {
    const runs = targetAgents.map((m) => ({
      room_id: roomId,
      agent_id: m.agent_id,
      trigger_msg_id: message.id,
      status: 'queued',
      round_index: roundIndex,
    }))

    const { data: insertedRuns } = await supabase
      .from('agent_runs')
      .insert(runs)
      .select()

    if (insertedRuns) agentRuns.push(...insertedRuns)
  }

  return apiSuccess({ message, agent_runs: agentRuns }, 201)
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params
  const { data: { user }, error: authErr } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomOwner(supabase, roomId, user.id)
    await clearRoomChat(supabase, roomId)
  } catch (e) {
    if (e instanceof Response) return e
    return apiError('INTERNAL_ERROR', e instanceof Error ? e.message : 'Failed to clear chat', 500)
  }

  return apiSuccess({ cleared: true })
}
