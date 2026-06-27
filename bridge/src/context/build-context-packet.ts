import { getDb, rowToFile, rowToMessage, rowToPinnedItem } from '@agentroom/db'
import type {
  AgentProvider,
  ContextPacketV1,
  DiscussionMode,
  PinnedItem,
  ReplyMode,
  SenderType,
} from '@agentroom/shared'
import { readDiscussionMetadata } from '@agentroom/shared'

import { recallMemory } from '../memory/recall.js'
import {
  readContextMessageLimit,
  readContextMessageMaxChars,
  readDiscussionContextLimit,
  trimContextMessages,
} from './context-window.js'
import {
  type ContextFilePreview,
  type FilePreviewRow,
  hydrateFilePreviews,
} from './file-context.js'

interface BuildContextArgs {
  run: {
    id: string
    room_id: string
    round_index: number
    discussion_mode: DiscussionMode
    deliberation_depth: number
    deliberation_root_id: string | null
  }
  agentInfo: {
    id: string
    name: string
    slug: string
    system_prompt: string | null
    provider: string
  }
  triggerMsg: {
    id: string
    content: string
    sender_type: string
    sender_user_id?: string | null
    created_at: string
    metadata?: Record<string, unknown>
  }
}

interface RecentMsg {
  id: string
  content: string
  sender_type: string
  sender_agent_id: string | null
  created_at: string
  metadata: Record<string, unknown>
}

export async function buildContextPacket({
  run,
  agentInfo,
  triggerMsg,
}: BuildContextArgs): Promise<ContextPacketV1> {
  const db = getDb()
  const contextMessageLimit = readContextMessageLimit()
  const contextMessageMaxChars = readContextMessageMaxChars()

  const roomRaw = db
    .prepare(
      'SELECT id, name, reply_mode, max_agent_rounds, discussion_mode, context_reset_at FROM rooms WHERE id = ?',
    )
    .get(run.room_id)
  if (!roomRaw) throw new Error(`Room ${run.room_id} not found`)
  const room = roomRaw as unknown as {
    id: string
    name: string
    reply_mode: string
    max_agent_rounds: number
    discussion_mode: DiscussionMode
    context_reset_at: string | null
  }

  // ADR-0011: in a discussion, an agent MUST see its teammates' contributions in this same
  // thread — including peer replies written AFTER this run's trigger timestamp. The normal
  // `created_at <= trigger` window (below) made phase-N agents blind to each other. So for a
  // discussion run we instead load the WHOLE thread by original_message_id, ignoring the
  // timestamp ceiling, and filter out the acting agent's OWN reply from the CURRENT phase
  // (self-echo) so it doesn't re-read its own draft as if it were a peer's.
  const discussion = readDiscussionMetadata(triggerMsg.metadata)
  // Defense-in-depth: original_message_id must be a server-generated UUID. The web route already
  // strips client-supplied discussion metadata, but if a non-UUID ever reached here it would be
  // interpolated into the PostgREST .or() filter below — so hard-validate before trusting it.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const useDiscussionScope = Boolean(discussion && UUID_RE.test(discussion.original_message_id))
  let recentMessages: RecentMsg[]

  if (discussion && useDiscussionScope) {
    const discId = discussion.original_message_id // validated UUID — safe in a PostgREST filter
    let threadSql =
      "SELECT id, content, sender_type, sender_agent_id, created_at, metadata FROM messages WHERE room_id = ? AND (json_extract(metadata, '$.discussion.original_message_id') = ? OR id = ?)"
    const threadParams: unknown[] = [run.room_id, discId, discId]
    if (room.context_reset_at) {
      threadSql += ' AND created_at >= ?'
      threadParams.push(room.context_reset_at)
    }
    threadSql += ' ORDER BY created_at ASC LIMIT ?'
    threadParams.push(readDiscussionContextLimit())
    const threadRaw = db.prepare(threadSql).all(...threadParams)
    const filtered = (threadRaw.map(toRecentMsg) as RecentMsg[]).filter(
      (m) =>
        !(
          m.sender_agent_id === agentInfo.id &&
          readDiscussionMetadata(m.metadata)?.phase === discussion.phase
        ),
    )
    recentMessages = trimContextMessages(filtered, contextMessageMaxChars)
  } else {
    // `/reset` (admin+) stamps a watermark: agents only see messages at/after it,
    // so their rolling context starts fresh while the transcript stays intact.
    let recentSql =
      'SELECT id, content, sender_type, sender_agent_id, created_at, metadata FROM messages WHERE room_id = ? AND created_at <= ?'
    const recentParams: unknown[] = [run.room_id, triggerMsg.created_at]
    if (room.context_reset_at) {
      recentSql += ' AND created_at >= ?'
      recentParams.push(room.context_reset_at)
    }
    recentSql += ' ORDER BY created_at DESC LIMIT ?'
    recentParams.push(contextMessageLimit)
    const recentRaw = db.prepare(recentSql).all(...recentParams)
    recentMessages = trimContextMessages(
      (recentRaw.map(toRecentMsg) as RecentMsg[]).reverse(),
      contextMessageMaxChars,
    )
  }

  const pinnedRaw = db
    .prepare(
      'SELECT * FROM pinned_items WHERE room_id = ? AND is_active = 1 ORDER BY sort_order ASC',
    )
    .all(run.room_id)
  const pinnedItems = pinnedRaw.map((r) => rowToPinnedItem(r as Record<string, unknown>))

  const fileIds = recentMessages.flatMap((m) => {
    const ids = (m.metadata as Record<string, unknown>)?.file_ids
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  })

  let files: ContextFilePreview[] = []
  if (fileIds.length > 0) {
    const uniqueFileIds = [...new Set(fileIds)].slice(0, 10)
    const fileRows = db
      .prepare(
        `SELECT id, filename, mime_type, size_bytes, storage_path, storage_bucket, extracted_text, metadata FROM files WHERE id IN (${uniqueFileIds.map(() => '?').join(',')})`,
      )
      .all(...uniqueFileIds)
    files = await hydrateFilePreviews(
      fileRows.map((r) => rowToFile(r as Record<string, unknown>)) as unknown as FilePreviewRow[],
    )
  }

  // Roster of OTHER active room agents (Phase 10) — name, slug, capability blurb.
  const rosterRaw = db
    .prepare(
      `SELECT a.id AS id, a.name AS name, a.slug AS slug, a.capabilities AS capabilities, a.is_active AS is_active
       FROM room_members rm
       JOIN agents a ON a.id = rm.agent_id
       WHERE rm.room_id = ? AND rm.member_type = 'agent' AND rm.muted = 0 AND rm.reply_enabled = 1`,
      // Only advertise peers that are actually addressable — matches the hand-off
      // resolver + the mention path (both require reply_enabled).
    )
    .all(run.room_id)
  const roster = (rosterRaw as unknown as RosterAgentRow[])
    .filter((a): a is RosterAgentRow => Boolean(a && a.is_active && a.id !== agentInfo.id))
    .map((a) => ({ id: a.id, name: a.name, slug: a.slug, capabilities: a.capabilities ?? null }))

  // Recall ranked memory (Phase 9). Resilient — never breaks the run.
  const memory = await recallMemory({
    agentId: agentInfo.id,
    roomId: run.room_id,
    queryText: triggerMsg.content,
    userId: triggerMsg.sender_type === 'user' ? (triggerMsg.sender_user_id ?? null) : null,
  })

  return {
    schema_version: 1,
    run_id: run.id,
    room: {
      id: room.id,
      name: room.name,
      reply_mode: room.reply_mode as ReplyMode,
      max_agent_rounds: room.max_agent_rounds,
      discussion_mode: room.discussion_mode,
    },
    agent: {
      id: agentInfo.id,
      name: agentInfo.name,
      slug: agentInfo.slug,
      system_prompt: agentInfo.system_prompt,
      provider: agentInfo.provider as AgentProvider,
    },
    trigger_message: {
      id: triggerMsg.id,
      content: triggerMsg.content,
      sender_type: triggerMsg.sender_type as SenderType,
      created_at: triggerMsg.created_at,
    },
    recent_messages: recentMessages.map((m) => ({
      id: m.id,
      content: m.content,
      sender_type: m.sender_type as SenderType,
      sender_agent_id: m.sender_agent_id,
      created_at: m.created_at,
      metadata: m.metadata ?? {},
    })),
    pinned_items: (pinnedItems ?? []) as PinnedItem[],
    files,
    round_index: run.round_index,
    discussion_mode: run.discussion_mode,
    deliberation_depth: run.deliberation_depth,
    deliberation_root_id: run.deliberation_root_id,
    ...(roster.length > 0 ? { roster } : {}),
    ...(memory ? { memory } : {}),
  }
}

// Raw SQLite rows store `metadata` as JSON TEXT and booleans as 0/1; rowToMessage
// rehydrates them, and we project to the narrow RecentMsg shape used above.
function toRecentMsg(r: unknown): RecentMsg {
  const m = rowToMessage(r as Record<string, unknown>)
  return {
    id: m.id,
    content: m.content,
    sender_type: m.sender_type,
    sender_agent_id: m.sender_agent_id,
    created_at: m.created_at,
    metadata: m.metadata,
  }
}

interface RosterAgentRow {
  id: string
  name: string
  slug: string
  capabilities: string | null
  is_active: boolean
}
