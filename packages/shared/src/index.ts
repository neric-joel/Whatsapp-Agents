export const AGENTROOM_VERSION = '0.1.0';

export type DiscussionPhase = 'individual' | 'critique' | 'consensus';

export interface DiscussionCommand {
  command: 'discuss' | 'debate';
  prompt: string;
}

export function parseDiscussionCommand(content: string): DiscussionCommand | null {
  const match = content.trim().match(/^\/(discuss|debate)\b\s*([\s\S]*)$/i);
  if (!match) return null;

  return {
    command: match[1].toLowerCase() as DiscussionCommand['command'],
    prompt: match[2].trim(),
  };
}

export function parseDiscussionRequest(content: string): DiscussionCommand | null {
  const command = parseDiscussionCommand(content);
  if (command) return command;

  const everyoneQuestion = content.trim().match(/^@everyone\b\s+([\s\S]*\?)\s*$/i);
  if (!everyoneQuestion) return null;

  return {
    command: 'discuss',
    prompt: everyoneQuestion[1].trim(),
  };
}

export function nextDiscussionPhase(phase: DiscussionPhase): DiscussionPhase | null {
  if (phase === 'individual') return 'critique';
  if (phase === 'critique') return 'consensus';
  return null;
}

export function buildDiscussionPhasePrompt(phase: DiscussionPhase, originalPrompt: string): string {
  if (phase === 'critique') {
    return [
      'Discussion phase 2: critique and synthesis.',
      '',
      'Original problem:',
      originalPrompt,
      '',
      'Read the independent agent answers above. Identify mistakes, missing edge cases, and over/under-abstraction. Engage directly with the other agents by name when useful. Do not just solve alone; compare approaches and move the group toward a stronger answer.',
    ].join('\n');
  }

  if (phase === 'consensus') {
    return [
      'Discussion phase 3: consensus and conclusion.',
      '',
      'Original problem:',
      originalPrompt,
      '',
      'Use the prior independent answers and critique round to produce one clear final consensus response for the room. State the final answer, explain the reasoning compactly, and mention any caveats the team agreed matter.',
    ].join('\n');
  }

  return [
    'Discussion phase 1: independent assessment.',
    '',
    'Original problem:',
    originalPrompt,
    '',
    'Give your own independent answer first. Do not assume another agent has solved it yet. Be clear about your reasoning and any assumptions.',
  ].join('\n');
}

export function conclusionDetected(content: string): boolean {
  const patterns = [
    /\bin conclusion\b/i,
    /\bfinal answer\b/i,
    /\btherefore the answer is\b/i,
    /\bto summarize\b/i,
    /\bin summary\b/i,
    /\[CONCLUSION\]/i,
    /^conclusion:/im,
  ];

  return patterns.some((p) => p.test(content));
}

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
  is_archived: boolean;
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
  tool_permissions: Record<string, unknown>;
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
  metadata: Record<string, unknown>;
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
  agent_id: string | null;
  tool_name: string;
  tool_category: string | null;
  input_args: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: ToolCallStatus;
  requires_approval: boolean;
  error: string | null;
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
  metadata: Record<string, unknown>;
  extracted_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface PinnedItem {
  id: string;
  room_id: string;
  message_id: string | null;
  pinned_by: string | null;
  note: string | null;
  pin_type: string;
  title: string | null;
  content: string | null;
  visibility: string;
  is_active: boolean;
  sort_order: number;
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
export type ToolCallStatus = 'pending' | 'waiting_approval' | 'approved' | 'running' | 'queued' | 'succeeded' | 'denied' | 'executed' | 'failed' | 'error';

// ─── CONTEXT PACKET V1 ───

export interface ContextPacketV1 {
  schema_version: 1;
  run_id: string;
  room: Pick<Room, 'id' | 'name' | 'reply_mode' | 'max_agent_rounds'>;
  agent: Pick<Agent, 'id' | 'name' | 'slug' | 'system_prompt' | 'provider'>;
  trigger_message: Pick<Message, 'id' | 'content' | 'sender_type' | 'created_at'>;
  recent_messages: Array<Pick<Message, 'id' | 'content' | 'sender_type' | 'sender_agent_id' | 'created_at' | 'metadata'>>;
  pinned_items?: PinnedItem[];
  files?: Array<{ id: string; filename: string; mime_type: string; size_bytes: number; extracted_text_preview: string | null }>;
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
  | { type: 'tool_call_requested'; run_id: string; tool_name: string; tool_category?: string; arguments: Record<string, unknown>; requires_approval: boolean }
  | { type: 'visible_message'; run_id: string; content: string };

// ─── AGENT ADAPTER INTERFACE ───

export interface AgentAdapter {
  run(packet: ContextPacketV1, signal: AbortSignal): AsyncIterable<AgentEvent>;
}

// ─── API ENVELOPE TYPES ───

export type ApiOk<T>       = { ok: true;  data: T };
export type ApiError       = { ok: false; error: string };
export type ApiResponse<T> = ApiOk<T> | ApiError;
