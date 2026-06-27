import { z } from 'zod'

export const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  room_type: z.string().optional(),
  reply_mode: z.enum(['all', 'mentioned_only']).optional(),
  discussion_mode: z.enum(['independent', 'tag_turns']).optional(),
  visibility: z.enum(['private', 'public']).optional(),
  // The Cowork-style session this room belongs to (optional; legacy rooms have none).
  session_id: z.string().uuid().optional(),
})

// Sessions — a named working context bound to a folder on disk (Cowork "project").
export const createSessionSchema = z.object({
  // Absolute path the user "opens"; the route verifies it exists + is a directory.
  working_dir: z.string().min(1).max(4096),
  name: z.string().min(1).max(120).optional(),
})

export const updateSessionSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    // Bump last_active_at to mark this the active session (used when switching).
    touch: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'At least one field required')

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
  'cli',
] as const

export const AGENT_PROVIDERS = ['claude_code', 'codex', 'mock', 'openai', 'custom'] as const

// Connections — a connected CLI profile (config.json). Records WHERE a binary is
// and HOW to invoke it; auth stays the CLI's own job (no API keys requested). The
// optional `env` exists only for the rare CLI that needs an extra variable.
const CLI_KINDS = ['claude-code', 'codex-cli', 'generic'] as const

const cliSlug = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug must be lowercase letters, numbers, _ or -')

export const upsertCliProfileSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80),
  slug: cliSlug,
  bin: z.string().min(1).max(1000),
  args: z.array(z.string().max(1000)).max(64).optional(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(8000)).optional(),
  kind: z.enum(CLI_KINDS).optional(),
  enabled: z.boolean().optional(),
})

const agentSlug = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'slug must be lowercase letters, numbers, _ or -')

// Avatars are rendered as <img src>. Constrain to https to avoid mixed-content /
// tracking-pixel / (future) SSRF surfaces from an arbitrary URL scheme.
const avatarUrl = z
  .string()
  .url()
  .max(2000)
  .refine((u) => u.startsWith('https://'), 'avatar_url must be an https URL')

export const createAgentSchema = z.object({
  // The room the new agent is added to — admin+ membership of it is required.
  room_id: z.string().uuid(),
  name: z.string().min(1).max(80),
  slug: agentSlug,
  avatar_url: avatarUrl.optional(),
  provider: z.enum(AGENT_PROVIDERS),
  adapter_type: z.enum(AGENT_ADAPTER_TYPES).optional(),
  // For adapter_type 'cli': the connected CLI profile (config.json) this agent runs.
  // Stored in the agent's `provider` column so the bridge resolves the profile.
  cli_profile_id: z.string().min(1).max(80).optional(),
  model: z.string().max(100).optional(),
  system_prompt: z.string().max(8000).optional(),
  capabilities: z.string().max(500).optional(),
  reply_policy: z.enum(['always', 'reply_when_invoked', 'never']).optional(),
  // Accepted for forward-compat but does NOT grant tool auto-approval: the bridge
  // gates tools through the live approval flow, never this field.
  tool_permissions: z.record(z.string(), z.unknown()).optional(),
  // BYO credential (ADR-0010) — the caller's own credential to fuel this agent. The
  // create route verifies it belongs to the caller; the secret never touches this row.
  credential_id: z.string().uuid().nullable().optional(),
})

export const updateAgentSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    avatar_url: avatarUrl.nullable().optional(),
    model: z.string().max(100).nullable().optional(),
    system_prompt: z.string().max(8000).nullable().optional(),
    capabilities: z.string().max(500).nullable().optional(),
    reply_policy: z.enum(['always', 'reply_when_invoked', 'never']).optional(),
    is_active: z.boolean().optional(),
    credential_id: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'At least one field required')

// WS2 (ADR-0010) — register a BYO provider credential. The secret is encrypted
// server-side before storage and never returned to the browser.
export const createCredentialSchema = z.object({
  provider: z.enum(AGENT_PROVIDERS),
  label: z.string().min(1).max(80),
  secret: z.string().min(1).max(8000),
  // Optional custom endpoint (e.g. Azure/compatible). https-only to avoid SSRF/mixed-content.
  base_url: z
    .string()
    .url()
    .max(2000)
    .refine((u) => u.startsWith('https://'), 'base_url must be an https URL')
    .optional(),
  is_default: z.boolean().optional(),
})
