import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { roomId: string } }

async function requireRoomMember(roomId: string) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return { error: err('Unauthorized', 401) }

  const supabase = createSupabaseServiceClient()
  const { data: member } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', user.id)
    .eq('member_type', 'user')
    .single()
  if (!member) return { error: err('Forbidden', 403) }

  return { supabase, user }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requireRoomMember(params.roomId)
  if ('error' in auth) return auth.error

  const { data, error } = await auth.supabase
    .from('pinned_items')
    .select('*')
    .eq('room_id', params.roomId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) return err(error.message, 500)

  return ok(data ?? [])
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireRoomMember(params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  if (!body || typeof body.pin_type !== 'string') return err('pin_type is required')

  const { data, error } = await auth.supabase
    .from('pinned_items')
    .insert({
      room_id: params.roomId,
      message_id: typeof body.source_message_id === 'string' ? body.source_message_id : null,
      pin_type: body.pin_type,
      title: typeof body.title === 'string' ? body.title : null,
      content: typeof body.content === 'string' ? body.content : null,
      visibility: typeof body.visibility === 'string' ? body.visibility : 'primary',
      pinned_by: auth.user.id,
    })
    .select()
    .single()
  if (error || !data) return err(error?.message ?? 'Failed to create pin', 500)

  return ok(data, 201)
}
