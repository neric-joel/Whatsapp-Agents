import type {
  AgentProvider,
  ContextPacketV1,
  DiscussionMode,
  PinnedItem,
  ReplyMode,
  SenderType,
} from '@agentroom/shared'
import { readDiscussionMetadata } from '@agentroom/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

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
  supabase: SupabaseClient
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
  supabase,
  run,
  agentInfo,
  triggerMsg,
}: BuildContextArgs): Promise<ContextPacketV1> {
  const contextMessageLimit = readContextMessageLimit()
  const contextMessageMaxChars = readContextMessageMaxChars()

  const { data: roomRaw } = await supabase
    .from('rooms')
    .select('id, name, reply_mode, max_agent_rounds, discussion_mode, context_reset_at')
    .eq('id', run.room_id)
    .single()
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
  let recentMessages: RecentMsg[]

  if (discussion) {
    const discId = discussion.original_message_id // a UUID we wrote — safe in a PostgREST filter
    let threadQuery = supabase
      .from('messages')
      .select('id, content, sender_type, sender_agent_id, created_at, metadata')
      .eq('room_id', run.room_id)
      .or(`metadata->discussion->>original_message_id.eq.${discId},id.eq.${discId}`)
    if (room.context_reset_at) {
      threadQuery = threadQuery.gte('created_at', room.context_reset_at)
    }
    const { data: threadRaw } = await threadQuery
      .order('created_at', { ascending: true })
      .limit(readDiscussionContextLimit())
    const filtered = ((threadRaw ?? []) as RecentMsg[]).filter(
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
    let recentQuery = supabase
      .from('messages')
      .select('id, content, sender_type, sender_agent_id, created_at, metadata')
      .eq('room_id', run.room_id)
      .lte('created_at', triggerMsg.created_at)
    if (room.context_reset_at) {
      recentQuery = recentQuery.gte('created_at', room.context_reset_at)
    }
    const { data: recentRaw } = await recentQuery
      .order('created_at', { ascending: false })
      .limit(contextMessageLimit)
    recentMessages = trimContextMessages(
      ((recentRaw ?? []) as RecentMsg[]).reverse(),
      contextMessageMaxChars,
    )
  }

  const { data: pinnedItems } = await supabase
    .from('pinned_items')
    .select('*')
    .eq('room_id', run.room_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const fileIds = recentMessages.flatMap((m) => {
    const ids = (m.metadata as Record<string, unknown>)?.file_ids
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  })

  let files: ContextFilePreview[] = []
  if (fileIds.length > 0) {
    const uniqueFileIds = [...new Set(fileIds)].slice(0, 10)
    const { data: fileRows } = await supabase
      .from('files')
      .select(
        'id, filename, mime_type, size_bytes, storage_path, storage_bucket, extracted_text, metadata',
      )
      .in('id', uniqueFileIds)
    files = await hydrateFilePreviews(supabase, (fileRows ?? []) as FilePreviewRow[])
  }

  // Roster of OTHER active room agents (Phase 10) — name, slug, capability blurb.
  const { data: rosterRaw } = await supabase
    .from('room_members')
    .select('agent_id, agents!inner(id, name, slug, capabilities, is_active)')
    .eq('room_id', run.room_id)
    .eq('member_type', 'agent')
    .eq('muted', false)
    // Only advertise peers that are actually addressable — matches the hand-off
    // resolver + the mention path (both require reply_enabled).
    .eq('reply_enabled', true)
  const roster = ((rosterRaw ?? []) as unknown as Array<{ agents: RosterAgentRow | null }>)
    .map((r) => r.agents)
    .filter((a): a is RosterAgentRow => Boolean(a && a.is_active && a.id !== agentInfo.id))
    .map((a) => ({ id: a.id, name: a.name, slug: a.slug, capabilities: a.capabilities ?? null }))

  // Recall ranked memory (Phase 9). Resilient — never breaks the run.
  const memory = await recallMemory(supabase, {
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

interface RosterAgentRow {
  id: string
  name: string
  slug: string
  capabilities: string | null
  is_active: boolean
}
