import { z } from 'zod'

export const createRoomSchema = z.object({
  name: z.string().min(1).max(100),
  room_type: z.string().optional(),
  reply_mode: z.enum(['all', 'mentioned_only']).optional(),
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

export const updateRoomAgentMemberSchema = z.object({
  muted: z.boolean().optional(),
  reply_enabled: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, 'At least one field required')

export const signedUploadSchema = z.object({
  filename: z.string().min(1).refine(
    (s) => !s.includes('/') && !s.includes('\\'),
    'filename must not contain path separators',
  ),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
})

export const createPinSchema = z.object({
  source_message_id: z.string().uuid().optional(),
  pin_type: z.string().min(1),
  title: z.string().max(255).optional(),
  content: z.string().optional(),
  visibility: z.enum(['primary', 'secondary']).optional(),
})

export const updatePinSchema = z.object({
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
}).refine((d) => Object.keys(d).length > 0, 'At least one field required')
