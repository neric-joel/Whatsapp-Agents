import { apiError, apiSuccess } from '@/lib/api-error'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { toolCallId: string } }

export async function POST(_req: Request, { params }: RouteParams) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: toolCall } = await supabase
    .from('tool_calls')
    .select('id, room_id')
    .eq('id', params.toolCallId)
    .single()
  if (!toolCall) return apiError('NOT_FOUND', 'Tool call not found', 404)

  try {
    await requireRoomMember(supabase, (toolCall as { room_id: string }).room_id, user.id)
  } catch (e) {
    return e as Response
  }

  const { data, error } = await supabase
    .from('tool_calls')
    .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
    .eq('id', params.toolCallId)
    .eq('status', 'waiting_approval')
    .select()
    .single()
  if (error || !data) return apiError('CONFLICT', error?.message ?? 'Tool call is not waiting for approval', 400)

  return apiSuccess(data)
}
