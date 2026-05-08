import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // 1. Authenticate
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return err('Unauthorized', 401)

  // 2. Parse body
  const body = await req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return err('name is required')
  }

  const supabase = createSupabaseServiceClient()

  // 3. Insert room
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .insert({
      name: body.name.trim(),
      room_type: body.room_type ?? 'group',
      reply_mode: body.reply_mode ?? 'everyone',
      visibility: body.visibility ?? 'private',
      created_by_user_id: user.id,
    })
    .select()
    .single()

  if (roomErr || !room) return err(roomErr?.message ?? 'Failed to create room', 500)

  // 4. Insert creator as owner member
  const { error: memberErr } = await supabase
    .from('room_members')
    .insert({
      room_id: room.id,
      member_type: 'user',
      user_id: user.id,
      role: 'owner',
    })

  if (memberErr) return err(memberErr.message, 500)

  return ok(room, 201)
}
