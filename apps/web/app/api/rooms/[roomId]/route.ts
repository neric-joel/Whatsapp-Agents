import { apiError, apiSuccess } from '@/lib/api-error'
import { requireRoomOwner } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { roomId: string } }

export async function DELETE(_req: Request, { params }: RouteParams) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomOwner(supabase, params.roomId, user.id)
  } catch (e) {
    return e as Response
  }

  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', params.roomId)

  if (error) return apiError('INTERNAL_ERROR', error.message, 500)

  return apiSuccess({ deleted: true })
}
