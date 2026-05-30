import { NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams {
  params: { messageId: string }
}

const bodySchema = z.object({
  accepted: z.boolean(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { messageId } = params

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }

  const supabase = createSupabaseServiceClient()
  const { data: message, error: fetchErr } = await supabase
    .from('messages')
    .select('id, room_id, metadata, round_index')
    .eq('id', messageId)
    .maybeSingle()

  if (fetchErr) return internalError('hallucination fetch message', fetchErr)
  if (!message) return apiError('NOT_FOUND', 'Message not found', 404)

  try {
    await requireRoomMember(supabase, message.room_id as string, user.id)
  } catch (e) {
    return e as Response
  }

  const metadata = isRecord(message.metadata) ? message.metadata : {}
  const hallucination = isRecord(metadata.hallucination) ? metadata.hallucination : {}
  const nextMetadata = {
    ...metadata,
    hallucination: {
      ...hallucination,
      accepted: parsed.data.accepted,
      flagged: false,
    },
  }

  const { error: updateErr } = await supabase
    .from('messages')
    .update({ metadata: nextMetadata })
    .eq('id', messageId)

  if (updateErr) return internalError('hallucination update metadata', updateErr)

  if (!parsed.data.accepted) {
    const { error: systemErr } = await supabase.from('messages').insert({
      room_id: message.room_id,
      sender_type: 'system',
      content: 'User rejected this response as potentially inaccurate.',
      content_type: 'text',
      round_index: message.round_index ?? 0,
      metadata: { hallucination_rejection_for: messageId },
    })

    if (systemErr) return internalError('hallucination insert system message', systemErr)
  }

  return apiSuccess({ updated: true })
}
