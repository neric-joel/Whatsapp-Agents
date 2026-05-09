import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { toolCallId: string } }

export async function POST(_req: Request, { params }: RouteParams) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return err('Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: toolCall } = await supabase
    .from('tool_calls')
    .select('id, room_id')
    .eq('id', params.toolCallId)
    .single()
  if (!toolCall) return err('Tool call not found', 404)

  const { data: member } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', (toolCall as { room_id: string }).room_id)
    .eq('user_id', user.id)
    .eq('member_type', 'user')
    .single()
  if (!member) return err('Forbidden', 403)

  const { data, error } = await supabase
    .from('tool_calls')
    .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
    .eq('id', params.toolCallId)
    .eq('status', 'waiting_approval')
    .select()
    .single()
  if (error || !data) return err(error?.message ?? 'Tool call is not waiting for approval', 400)

  return ok(data)
}
