export const AGENTROOM_VERSION = '0.1.0';

// ─── DATABASE ROW TYPES ───

export interface Room {
  id: string;
  name: string;
  slug: string | null;
  room_type: RoomType;
  reply_mode: ReplyMode;
  max_agent_rounds: number;
  max_agent_hops: number;
  allow_agent_to_agent: boolean;
  visibility: string;
  last_message_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  slug: string;
  avatar_url: string | null;
  provider: AgentProvider;
  adapter_type: AdapterType;
  model: string | null;
  system_prompt: string | null;
  reply_policy: ReplyPolicy;
  is_active: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomMember {
  id: string;
  room_id: string;
  member_type: MemberType;
  user_id: string | null;
  agent_id: string | null;
  role: MemberRole;
  reply_enabled: boolean;
  muted: boolean;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  sender_type: SenderType;
  sender_user_id: string | null;
  sender_agent_id: string | null;
  content: string;
  content_type: 'text' | 'markdown';
  reply_to_id: string | null;
  thread_id: string | null;
  mentions: string[];
  target_agent_ids: string[];
  round_index: number;
  is_partial: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  room_id: string;
  agent_id: string;
  trigger_msg_id: string | null;
  status: RunStatus;
  round_index: number;
  error_message: string | null;
  partial_content: string | null;
  worker_id: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolCall {
  id: string;
  run_id: string;
  room_id: string;
  tool_name: string;
  input_args: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: ToolCallStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface File {
  id: string;
  room_id: string;
  uploader_user_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  storage_bucket: string;
  message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PinnedItem {
  id: string;
  room_id: string;
  message_id: string;
  pinned_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// ─── ENUMS / LITERAL TYPES ───

export type RoomType       = 'group' | 'dm';
export type ReplyMode      = 'everyone' | 'mentioned_only';
export type MemberType     = 'user' | 'agent';
export type MemberRole     = 'owner' | 'admin' | 'member';
export type SenderType     = 'user' | 'agent' | 'system';
export type AgentProvider  = 'claude_code' | 'codex_cli' | 'ruflo' | 'mock';
export type AdapterType    = 'subprocess' | 'mock';
export type ReplyPolicy    = 'always' | 'reply_when_invoked' | 'never';
export type RunStatus      = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
export type ToolCallStatus = 'pending' | 'waiting_approval' | 'approved' | 'denied' | 'executed' | 'error';

// ─── CONTEXT PACKET V1 ───

export interface ContextPacketV1 {
  schema_version: 1;
  run_id: string;
  room: Pick<Room, 'id' | 'name' | 'reply_mode' | 'max_agent_rounds'>;
  agent: Pick<Agent, 'id' | 'name' | 'slug' | 'system_prompt' | 'provider'>;
  trigger_message: Pick<Message, 'id' | 'content' | 'sender_type' | 'created_at'>;
  recent_messages: Array<Pick<Message, 'id' | 'content' | 'sender_type' | 'sender_agent_id' | 'created_at'>>;
  round_index: number;
}

// ─── AGENT RESPONSE V1 ───

export interface AgentResponseV1 {
  schema_version: 1;
  run_id: string;
  content: string;
  content_type?: 'text' | 'markdown';
}

// ─── AGENT EVENT ───

export type AgentEvent =
  | { type: 'partial_content'; run_id: string; delta: string }
  | { type: 'final_response';  run_id: string; response: AgentResponseV1 }
  | { type: 'error';           run_id: string; message: string }
  | { type: 'visible_message'; run_id: string; content: string };

// ─── AGENT ADAPTER INTERFACE ───

export interface AgentAdapter {
  run(packet: ContextPacketV1, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

// ─── API ENVELOPE TYPES ───

export type ApiOk<T>       = { ok: true;  data: T };
export type ApiError       = { ok: false; error: string };
export type ApiResponse<T> = ApiOk<T> | ApiError;
