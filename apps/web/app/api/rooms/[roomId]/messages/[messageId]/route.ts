import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'
import { requireRoomMember } from '@/lib/permissions'
import {
  canCurrentUserDeleteMessage,
  createDeletedMessagePatch,
} from '@/lib/message-management'

interface RouteParams {
  params: { roomId: string; messageId: string }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { roomId, messageId } = params
  const { data: { user }, error: authErr } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomMember(supabase, roomId, user.id)
  } catch (e) {
    return e as Response
  }

  const { data: message, error: fetchErr } = await supabase
    .from('messages')
    .select('id, sender_type, sender_user_id')
    .eq('id', messageId)
    .eq('room_id', roomId)
    .maybeSingle()

  if (fetchErr) return apiError('INTERNAL_ERROR', fetchErr.message, 500)
  if (!message) return apiError('NOT_FOUND', 'Message not found', 404)
  if (!canCurrentUserDeleteMessage(message, user.id)) {
    return apiError('FORBIDDEN', 'You can only delete your own messages', 403)
  }

  const { data: deletedMessage, error: updateErr } = await supabase
    .from('messages')
    .update(createDeletedMessagePatch())
    .eq('id', messageId)
    .eq('room_id', roomId)
    .select('id, content')
    .single()

  if (updateErr || !deletedMessage) {
    return apiError('INTERNAL_ERROR', updateErr?.message ?? 'Failed to delete message', 500)
  }

  return apiSuccess({ message: deletedMessage })
}
