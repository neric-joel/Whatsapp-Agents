import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { createPinSchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { roomId: string } }

async function requireAuthenticatedRoomMember(roomId: string) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomMember(supabase, roomId, user.id)
  } catch (e) {
    return { error: e as Response }
  }

  return { supabase, user }
}

export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(params.roomId)
  if ('error' in auth) return auth.error

  const { data, error } = await auth.supabase
    .from('pinned_items')
    .select('*')
    .eq('room_id', params.roomId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  if (error) return apiError('INTERNAL_ERROR', error.message, 500)

  return apiSuccess(data ?? [])
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = createPinSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const pinData = parseResult.data

  const { data, error } = await auth.supabase
    .from('pinned_items')
    .insert({
      room_id: params.roomId,
      message_id: pinData.source_message_id ?? null,
      pin_type: pinData.pin_type,
      title: pinData.title ?? null,
      content: pinData.content ?? null,
      visibility: pinData.visibility ?? 'primary',
      pinned_by: auth.user.id,
    })
    .select()
    .single()
  if (error || !data) return apiError('INTERNAL_ERROR', error?.message ?? 'Failed to create pin', 500)

  return apiSuccess(data, 201)
}
