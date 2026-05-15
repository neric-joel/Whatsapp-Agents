import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { createRoomSchema } from '@/lib/api-validation'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  // 1. Authenticate
  const { data: { user }, error: authErr } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  // 2. Parse body
  const body = await req.json().catch(() => null)
  const parseResult = createRoomSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const data = parseResult.data
  const name = data.name.trim()
  if (!name) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, { fieldErrors: { name: ['name is required'] } })
  }

  const supabase = createSupabaseServiceClient()

  // 3. Insert room
  const { data: room, error: roomErr } = await supabase
    .from('rooms')
    .insert({
      name,
      room_type: data.room_type ?? 'group',
      reply_mode: data.reply_mode === 'all' ? 'everyone' : data.reply_mode ?? 'everyone',
      visibility: data.visibility ?? 'private',
      created_by_user_id: user.id,
    })
    .select()
    .single()

  if (roomErr || !room) return apiError('INTERNAL_ERROR', roomErr?.message ?? 'Failed to create room', 500)

  // 4. Insert creator as owner member
  const { error: memberErr } = await supabase
    .from('room_members')
    .insert({
      room_id: room.id,
      member_type: 'user',
      user_id: user.id,
      role: 'owner',
    })

  if (memberErr) return apiError('INTERNAL_ERROR', memberErr.message, 500)

  return apiSuccess(room, 201)
}
