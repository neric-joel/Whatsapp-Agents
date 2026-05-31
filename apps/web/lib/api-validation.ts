import { z } from 'zod'

export const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  room_type: z.string().optional(),
  reply_mode: z.enum(['all', 'mentioned_only']).optional(),
  discussion_mode: z.enum(['independent', 'tag_turns']).optional(),
  visibility: z.enum(['private', 'public']).optional(),
})

export const updateRoomArchiveSchema = z.object({
  is_archived: z.boolean(),
})

export const sendMessageSchema = z.object({
  content: z.string().min(1),
  content_type: z.string().optional(),
  reply_to_id: z.string().uuid().optional(),
  mentions: z.array(z.string()).optional(),
  target_agent_ids: z.array(z.string().uuid()).optional(),
  round_index: z.number().int().nonnegative().optional(),
  hop_index: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const addRoomAgentSchema = z.object({
  agentId: z.string().uuid(),
})

export const updateRoomAgentMemberSchema = z
  .object({
    muted: z.boolean().optional(),
    reply_enabled: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'At least one field required')

/** Max upload size accepted by the signed-upload route (also capped by the bucket). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

/** Allowlisted MIME types for uploads. Anything else is rejected. */
export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
] as const

export const signedUploadSchema = z.object({
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (s) => !s.includes('/') && !s.includes('\\') && !s.includes('\0') && s !== '.' && s !== '..',
      'filename must not contain path separators or traversal sequences',
    ),
  mime_type: z.enum(ALLOWED_UPLOAD_MIME_TYPES as unknown as [string, ...string[]]),
  size_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
})

export const createPinSchema = z.object({
  source_message_id: z.string().uuid().optional(),
  pin_type: z.string().min(1),
  title: z.string().max(255).optional(),
  content: z.string().optional(),
  visibility: z.enum(['primary', 'secondary']).optional(),
})

export const updatePinSchema = z
  .object({
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'At least one field required')

// Phase 9 — agent memory. `/remember` (user-authored) stores room-shared notes by
// default; `--global` stores a personal cross-room note.
export const createMemorySchema = z.object({
  content: z.string().min(1).max(8000),
  scope: z.enum(['global', 'room']).optional(),
  kind: z.enum(['fact', 'preference', 'skill', 'episodic']).optional(),
  title: z.string().max(200).optional(),
})

export const updateMemorySchema = z
  .object({
    is_active: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'At least one field required')

// Phase 11 — user-created agents. adapter_type is allowlisted to the adapters the
// bridge actually implements (an unknown type would crash the run-worker). A
// user-set `system_prompt` is attacker-influenced: the bridge delivers it to the
// CLI via stdin only, never argv (see bridge/src/lib/subprocess-security.ts and
// the subprocess-security tests) — this schema does not relax that invariant.
export const AGENT_ADAPTER_TYPES = [
  'mock',
  'claude-code',
  'subprocess',
  'codex-cli',
  'myclaude',
  'ruflo',
] as const

export const AGENT_PROVIDERS = [
  'claude_code',
  'codex',
  'mock',
  'ruflo',
  'myclaude',
  'openai',
  'custom',
] as const

const agentSlug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug must be lowercase letters, numbers, _ or -')

export const createAgentSchema = z.object({
  // The room the new agent is added to — admin+ membership of it is required.
  room_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  slug: agentSlug,
  avatar_url: z.string().url().max(2000).optional(),
  provider: z.enum(AGENT_PROVIDERS),
  adapter_type: z.enum(AGENT_ADAPTER_TYPES).optional(),
  model: z.string().max(100).optional(),
  system_prompt: z.string().max(8000).optional(),
  capabilities: z.string().max(500).optional(),
  reply_policy: z.enum(['always', 'reply_when_invoked', 'never']).optional(),
  // Accepted for forward-compat but does NOT grant tool auto-approval: the bridge
  // gates tools through the live approval flow, never this field.
  tool_permissions: z.record(z.string(), z.unknown()).optional(),
})

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    avatar_url: z.string().url().max(2000).nullable().optional(),
    model: z.string().max(100).nullable().optional(),
    system_prompt: z.string().max(8000).nullable().optional(),
    capabilities: z.string().max(500).nullable().optional(),
    reply_policy: z.enum(['always', 'reply_when_invoked', 'never']).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'At least one field required')
