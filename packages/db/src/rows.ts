import type {
  Agent,
  AgentRun,
  File as RoomFile,
  MemoryEntry,
  Message,
  PinnedItem,
  Room,
  RoomMember,
  Session,
  ToolCall,
} from '@agentroom/shared'

/**
 * Mappers from raw SQLite rows to the shared domain types.
 *
 * SQLite stores booleans as INTEGER 0/1 and json columns as TEXT, so every read
 * goes through here to rehydrate `boolean` and `Record`/`array` shapes. Write
 * helpers (`intBool`, `jsonText`) do the inverse for INSERT/UPDATE params.
 */

type DbRow = Record<string, unknown>

const str = (v: unknown): string => (v == null ? '' : String(v))
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v))
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))
const bool = (v: unknown): boolean => v === 1 || v === true || v === '1'

const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v === 'string' && v) {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return {}
}

const objOrNull = (v: unknown): Record<string, unknown> | null => {
  if (v == null || v === '') return null
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  return null
}

const strArray = (v: unknown): string[] => {
  if (typeof v === 'string' && v) {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? (parsed as string[]) : []
    } catch {
      return []
    }
  }
  return []
}

// ── write helpers ────────────────────────────────────────────────────────────
/** Boolean -> 0/1 for SQLite. */
export const intBool = (b: boolean): number => (b ? 1 : 0)
/** Any value -> JSON TEXT for a jsonb-style column. */
export const jsonText = (v: unknown): string => JSON.stringify(v ?? null)

// ── row -> domain mappers ─────────────────────────────────────────────────────
export function rowToRoom(r: DbRow): Room {
  return {
    id: str(r['id']),
    name: str(r['name']),
    slug: strOrNull(r['slug']),
    room_type: str(r['room_type']) as Room['room_type'],
    reply_mode: str(r['reply_mode']) as Room['reply_mode'],
    max_agent_rounds: num(r['max_agent_rounds']),
    max_agent_hops: num(r['max_agent_hops']),
    allow_agent_to_agent: bool(r['allow_agent_to_agent']),
    discussion_mode: str(r['discussion_mode']) as Room['discussion_mode'],
    visibility: str(r['visibility']),
    is_archived: bool(r['is_archived']),
    last_message_at: strOrNull(r['last_message_at']),
    session_id: strOrNull(r['session_id']),
    created_by_user_id: strOrNull(r['created_by_user_id']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToSession(r: DbRow): Session {
  return {
    id: str(r['id']),
    name: str(r['name']),
    working_dir: str(r['working_dir']),
    created_by_user_id: strOrNull(r['created_by_user_id']),
    last_active_at: str(r['last_active_at']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToAgent(r: DbRow): Agent {
  return {
    id: str(r['id']),
    name: str(r['name']),
    slug: str(r['slug']),
    avatar_url: strOrNull(r['avatar_url']),
    provider: str(r['provider']) as Agent['provider'],
    adapter_type: str(r['adapter_type']) as Agent['adapter_type'],
    model: strOrNull(r['model']),
    system_prompt: strOrNull(r['system_prompt']),
    reply_policy: str(r['reply_policy']) as Agent['reply_policy'],
    tool_permissions: obj(r['tool_permissions']),
    capabilities: strOrNull(r['capabilities']),
    is_active: bool(r['is_active']),
    created_by_user_id: strOrNull(r['created_by_user_id']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToRoomMember(r: DbRow): RoomMember {
  return {
    id: str(r['id']),
    room_id: str(r['room_id']),
    member_type: str(r['member_type']) as RoomMember['member_type'],
    user_id: strOrNull(r['user_id']),
    agent_id: strOrNull(r['agent_id']),
    role: str(r['role']) as RoomMember['role'],
    reply_enabled: bool(r['reply_enabled']),
    muted: bool(r['muted']),
    joined_at: str(r['joined_at']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToMessage(r: DbRow): Message {
  return {
    id: str(r['id']),
    room_id: str(r['room_id']),
    sender_type: str(r['sender_type']) as Message['sender_type'],
    sender_user_id: strOrNull(r['sender_user_id']),
    sender_agent_id: strOrNull(r['sender_agent_id']),
    content: str(r['content']),
    content_type: str(r['content_type'] || 'text') as Message['content_type'],
    reply_to_id: strOrNull(r['reply_to_id']),
    thread_id: strOrNull(r['thread_id']),
    mentions: strArray(r['mentions']),
    target_agent_ids: strArray(r['target_agent_ids']),
    round_index: num(r['round_index']),
    is_partial: bool(r['is_partial']),
    metadata: obj(r['metadata']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToAgentRun(r: DbRow): AgentRun {
  return {
    id: str(r['id']),
    room_id: str(r['room_id']),
    agent_id: str(r['agent_id']),
    trigger_msg_id: strOrNull(r['trigger_msg_id']),
    status: str(r['status']) as AgentRun['status'],
    round_index: num(r['round_index']),
    discussion_mode: str(r['discussion_mode']) as AgentRun['discussion_mode'],
    deliberation_depth: num(r['deliberation_depth']),
    deliberation_root_id: strOrNull(r['deliberation_root_id']),
    error_message: strOrNull(r['error_message']),
    partial_content: strOrNull(r['partial_content']),
    worker_id: strOrNull(r['worker_id']),
    heartbeat_at: strOrNull(r['heartbeat_at']),
    started_at: strOrNull(r['started_at']),
    completed_at: strOrNull(r['completed_at']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToToolCall(r: DbRow): ToolCall {
  return {
    id: str(r['id']),
    run_id: str(r['run_id']),
    room_id: str(r['room_id']),
    agent_id: strOrNull(r['agent_id']),
    tool_name: str(r['tool_name']),
    tool_category: strOrNull(r['tool_category']),
    input_args: obj(r['input_args']),
    output: objOrNull(r['output']),
    status: str(r['status']) as ToolCall['status'],
    requires_approval: bool(r['requires_approval']),
    error: strOrNull(r['error']),
    approved_by: strOrNull(r['approved_by']),
    approved_at: strOrNull(r['approved_at']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToFile(r: DbRow): RoomFile {
  return {
    id: str(r['id']),
    room_id: str(r['room_id']),
    uploader_user_id: strOrNull(r['uploader_user_id']),
    filename: str(r['filename']),
    mime_type: str(r['mime_type']),
    size_bytes: num(r['size_bytes']),
    storage_path: str(r['storage_path']),
    storage_bucket: str(r['storage_bucket']),
    message_id: strOrNull(r['message_id']),
    metadata: obj(r['metadata']),
    extracted_text: strOrNull(r['extracted_text']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToPinnedItem(r: DbRow): PinnedItem {
  return {
    id: str(r['id']),
    room_id: str(r['room_id']),
    message_id: strOrNull(r['message_id']),
    pinned_by: strOrNull(r['pinned_by']),
    note: strOrNull(r['note']),
    pin_type: str(r['pin_type']),
    title: strOrNull(r['title']),
    content: strOrNull(r['content']),
    visibility: str(r['visibility']),
    is_active: bool(r['is_active']),
    sort_order: num(r['sort_order']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}

export function rowToMemoryEntry(r: DbRow): MemoryEntry {
  return {
    id: str(r['id']),
    agent_id: strOrNull(r['agent_id']),
    room_id: strOrNull(r['room_id']),
    scope: str(r['scope']) as MemoryEntry['scope'],
    kind: str(r['kind']) as MemoryEntry['kind'],
    title: strOrNull(r['title']),
    content: str(r['content']),
    source_message_id: strOrNull(r['source_message_id']),
    created_by_user_id: strOrNull(r['created_by_user_id']),
    confidence: num(r['confidence']),
    pinned: bool(r['pinned']),
    is_active: bool(r['is_active']),
    injection_flagged: bool(r['injection_flagged']),
    created_at: str(r['created_at']),
    updated_at: str(r['updated_at']),
  }
}
