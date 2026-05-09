import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { pinId: string } }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return err('Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: pin } = await supabase
    .from('pinned_items')
    .select('id, room_id')
    .eq('id', params.pinId)
    .single()
  if (!pin) return err('Pin not found', 404)

  const { data: member } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', (pin as { room_id: string }).room_id)
    .eq('user_id', user.id)
    .eq('member_type', 'user')
    .single()
  if (!member) return err('Forbidden', 403)

  const body = await req.json().catch(() => null)
  const updates: { is_active?: boolean; sort_order?: number } = {}
  if (body && typeof body.is_active === 'boolean') updates.is_active = body.is_active
  if (body && typeof body.sort_order === 'number') updates.sort_order = body.sort_order
  if (Object.keys(updates).length === 0) return err('No supported fields to update')

  const { data, error } = await supabase
    .from('pinned_items')
    .update(updates)
    .eq('id', params.pinId)
    .select()
    .single()
  if (error || !data) return err(error?.message ?? 'Failed to update pin', 500)

  return ok(data)
}
