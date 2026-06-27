import { getDb, jsonText, newId, rowToMessage } from '@agentroom/db'
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
import { getAuthenticatedUser } from '@/lib/auth'
import { parseMentions } from '@/lib/mention-parser'
import { stripServerOwnedMetadata } from '@/lib/message-metadata'
import { requireRoomMember, requireRoomOwner } from '@/lib/permissions'
import { clearRoomChat } from '@/lib/room-chat-management'

interface RouteParams {
  params: { roomId: string }
}

type AgentJoin = {
  id: string
  slug: string
  name: string
  provider: string
  capabilities: string | null
  is_active: boolean
}

type AgentMemberRow = {
  agent_id: string
  agents: AgentJoin
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
  const db = getDb()
  try {
    await requireRoomMember(roomId, user.id)
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
  let room:
    | {
        id: string
        reply_mode: string
        max_agent_rounds: number
        max_agent_hops: number
        allow_agent_to_agent: number
        discussion_mode: DiscussionMode | null
      }
    | undefined
  try {
    room = db
      .prepare(
        'SELECT id, reply_mode, max_agent_rounds, max_agent_hops, allow_agent_to_agent, discussion_mode FROM rooms WHERE id = ?',
      )
      .get(roomId) as typeof room
  } catch (e) {
    return internalError('room fetch', e)
  }

  if (!room) return apiError('NOT_FOUND', 'Room not found', 404)

  // 5. Insert message. SECURITY: the server is the SOLE author of `metadata.discussion` — strip
  // any client-supplied block before re-adding a trusted one (see stripServerOwnedMetadata).
  const initialMetadata = {
    ...stripServerOwnedMetadata(data.metadata),
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

  let messageRow: Record<string, unknown> | undefined
  try {
    messageRow = db
      .prepare(
        `INSERT INTO messages
           (id, room_id, sender_type, sender_user_id, content, content_type, reply_to_id, mentions, target_agent_ids, round_index, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        newId(),
        roomId,
        'user',
        user.id,
        content,
        data.content_type ?? 'text',
        data.reply_to_id ?? null,
        jsonText(data.mentions ?? []),
        jsonText(data.target_agent_ids ?? []),
        roundIndex,
        jsonText(initialMetadata),
      ) as Record<string, unknown> | undefined
  } catch (e) {
    return internalError('messages insert', e)
  }

  if (!messageRow) return internalError('messages insert', new Error('insert returned no row'))

  const message = rowToMessage(messageRow)

  const rawFileIds = (data.metadata as { file_ids?: unknown } | undefined)?.file_ids
  const fileIds = Array.isArray(rawFileIds)
    ? rawFileIds.filter((id): id is string => typeof id === 'string')
    : []
  if (fileIds.length > 0) {
    try {
      db.prepare(
        `UPDATE files SET message_id = ?, metadata = ? WHERE id IN (${fileIds
          .map(() => '?')
          .join(',')}) AND room_id = ?`,
      ).run(message.id, jsonText({ upload_status: 'attached' }), ...fileIds, roomId)
    } catch (e) {
      return internalError('files attach', e)
    }
  }

  // NOTE: the discussion metadata is finalized below (after the coordinator is picked) so
  // original_message_id + coordinator_agent_id are written in a single patch.

  // 6. Update room.last_message_at
  try {
    db.prepare('UPDATE rooms SET last_message_at = ? WHERE id = ?').run(
      messageRow['created_at'] as string,
      roomId,
    )
  } catch (e) {
    return internalError('room last_message_at update', e)
  }

  const insertSystemMessage = (content: string) =>
    db
      .prepare(
        `INSERT INTO messages
           (id, room_id, sender_type, content, content_type, mentions, target_agent_ids, round_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(newId(), roomId, 'system', content, 'text', jsonText([]), jsonText([]), roundIndex)

  // 7. Loop guard
  const maxRounds = room.max_agent_rounds
  const maxHops = room.max_agent_hops
  const discussionMode: DiscussionMode = room.discussion_mode ?? 'independent'

  if (roundIndex >= maxRounds) {
    insertSystemMessage(`Loop guard: agent discussion stopped after ${maxRounds} rounds.`)
    return apiSuccess({ message, agent_runs: [] }, 201)
  }

  if (hopIndex >= maxHops) {
    insertSystemMessage(`Loop guard: agent chain stopped after ${maxHops} hops.`)
    return apiSuccess({ message, agent_runs: [] }, 201)
  }

  // 8. Find active, unmuted agents with reply_enabled=true
  let rawMembers: AgentMemberRow[]
  try {
    const memberRows = db
      .prepare(
        `SELECT rm.agent_id AS agent_id,
                a.id AS a_id, a.slug AS a_slug, a.name AS a_name,
                a.provider AS a_provider, a.capabilities AS a_capabilities, a.is_active AS a_is_active
           FROM room_members rm
           JOIN agents a ON a.id = rm.agent_id
          WHERE rm.room_id = ? AND rm.member_type = 'agent' AND rm.reply_enabled = 1 AND rm.muted = 0`,
      )
      .all(roomId) as Array<{
      agent_id: string
      a_id: string
      a_slug: string
      a_name: string
      a_provider: string
      a_capabilities: string | null
      a_is_active: number
    }>
    rawMembers = memberRows.map((r) => ({
      agent_id: r.agent_id,
      agents: {
        id: r.a_id,
        slug: r.a_slug,
        name: r.a_name,
        provider: r.a_provider,
        capabilities: r.a_capabilities,
        is_active: r.a_is_active === 1,
      },
    }))
  } catch (e) {
    return internalError('room members fetch', e)
  }

  const allActive = rawMembers.filter((m) => m.agents?.is_active)

  // 9. Mention-based routing
  const mentions = parseMentions(
    rawContent,
    allActive.map((m) => m.agents),
  )
  const replyMode = room.reply_mode

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
      insertSystemMessage('No active agents are available to start a discussion.')
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
    try {
      db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(
        jsonText(nextMetadata),
        message.id,
      )
    } catch (e) {
      return internalError('message metadata update', e)
    }
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
    insertSystemMessage(systemMessage)
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

    try {
      const insertRun = db.prepare(
        `INSERT INTO agent_runs
           (id, room_id, agent_id, trigger_msg_id, status, round_index, discussion_mode, deliberation_depth, deliberation_root_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      for (const run of runs) {
        const inserted = insertRun.get(
          newId(),
          run.room_id,
          run.agent_id,
          run.trigger_msg_id,
          run.status,
          run.round_index,
          run.discussion_mode,
          run.deliberation_depth,
          run.deliberation_root_id,
        )
        if (inserted) agentRuns.push(inserted)
      }
    } catch (e) {
      return internalError('agent_runs insert', e)
    }
  }

  return apiSuccess({ message, agent_runs: agentRuns }, 201)
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()
  try {
    await requireRoomMember(roomId, user.id)
  } catch (e) {
    return e as Response
  }

  try {
    const rows = db
      .prepare(
        `SELECT m.*, a.name AS agent_name, a.provider AS agent_provider
           FROM messages m
           LEFT JOIN agents a ON a.id = m.sender_agent_id
          WHERE m.room_id = ?
          ORDER BY m.created_at ASC`,
      )
      .all(roomId) as Array<
      Record<string, unknown> & {
        agent_name: string | null
        agent_provider: string | null
      }
    >

    const messages = rows.map((r) => ({
      id: r['id'] as string,
      content: r['content'] as string,
      sender_type: r['sender_type'] as string,
      sender_user_id: (r['sender_user_id'] ?? null) as string | null,
      created_at: r['created_at'] as string,
      sender_agent_id: (r['sender_agent_id'] ?? null) as string | null,
      reply_to_id: (r['reply_to_id'] ?? null) as string | null,
      content_type: r['content_type'] as string,
      metadata: JSON.parse((r['metadata'] as string) || '{}'),
      agents: r.agent_name ? { name: r.agent_name, provider: r.agent_provider } : null,
    }))

    return apiSuccess(messages)
  } catch (e) {
    return internalError('messages list', e)
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  try {
    await requireRoomOwner(roomId, user.id)
    await clearRoomChat(roomId)
  } catch (e) {
    if (e instanceof Response) return e
    return internalError('messages clear chat', e)
  }

  return apiSuccess({ cleared: true })
}
