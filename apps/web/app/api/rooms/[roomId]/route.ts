import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { updateRoomArchiveSchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams { params: { roomId: string } }

async function requireAuthenticatedRoomMember(req: NextRequest, roomId: string) {
  const { data: { user }, error: authErr } = await getAuthenticatedUser(req)
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomMember(supabase, roomId, user.id)
  } catch (e) {
    return { error: e as Response }
  }

  return { supabase, user }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = updateRoomArchiveSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }

  const { data, error } = await auth.supabase
    .from('rooms')
    .update({ is_archived: parseResult.data.is_archived })
    .eq('id', params.roomId)
    .select()
    .single()

  if (error || !data) return apiError('INTERNAL_ERROR', error?.message ?? 'Failed to update room', 500)

  return apiSuccess(data)
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const { error } = await auth.supabase
    .from('rooms')
    .delete()
    .eq('id', params.roomId)

  if (error) return apiError('INTERNAL_ERROR', error.message, 500)

  return apiSuccess({ deleted: true })
}
