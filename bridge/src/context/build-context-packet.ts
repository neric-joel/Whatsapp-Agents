import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentProvider, ContextPacketV1, PinnedItem, ReplyMode, SenderType } from '@agentroom/shared'

interface BuildContextArgs {
  supabase: SupabaseClient
  run: {
    id: string
    room_id: string
    round_index: number
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
    created_at: string
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

interface FilePreviewRow {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  extracted_text: string | null
}

export async function buildContextPacket({
  supabase,
  run,
  agentInfo,
  triggerMsg,
}: BuildContextArgs): Promise<ContextPacketV1> {
  const { data: recentRaw } = await supabase
    .from('messages')
    .select('id, content, sender_type, sender_agent_id, created_at, metadata')
    .eq('room_id', run.room_id)
    .order('created_at', { ascending: false })
    .limit(10)
  const recentMessages = ((recentRaw ?? []) as RecentMsg[]).reverse()

  const { data: roomRaw } = await supabase
    .from('rooms')
    .select('id, name, reply_mode, max_agent_rounds')
    .eq('id', run.room_id)
    .single()
  if (!roomRaw) throw new Error(`Room ${run.room_id} not found`)
  const room = roomRaw as unknown as { id: string; name: string; reply_mode: string; max_agent_rounds: number }

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

  let files: Array<{ id: string; filename: string; mime_type: string; size_bytes: number; extracted_text_preview: string | null }> = []
  if (fileIds.length > 0) {
    const uniqueFileIds = [...new Set(fileIds)].slice(0, 10)
    const { data: fileRows } = await supabase
      .from('files')
      .select('id, filename, mime_type, size_bytes, extracted_text')
      .in('id', uniqueFileIds)
    files = ((fileRows ?? []) as FilePreviewRow[]).map((f) => ({
      id: f.id,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      extracted_text_preview: f.extracted_text ? String(f.extracted_text).slice(0, 500) : null,
    }))
  }

  return {
    schema_version: 1,
    run_id: run.id,
    room: {
      id: room.id,
      name: room.name,
      reply_mode: room.reply_mode as ReplyMode,
      max_agent_rounds: room.max_agent_rounds,
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
  }
}
