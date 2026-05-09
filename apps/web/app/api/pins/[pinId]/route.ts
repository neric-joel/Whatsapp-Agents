import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { updatePinSchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { pinId: string } }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: pin } = await supabase
    .from('pinned_items')
    .select('id, room_id')
    .eq('id', params.pinId)
    .single()
  if (!pin) return apiError('NOT_FOUND', 'Pin not found', 404)

  try {
    await requireRoomMember(supabase, (pin as { room_id: string }).room_id, user.id)
  } catch (e) {
    return e as Response
  }

  const body = await req.json().catch(() => null)
  const parseResult = updatePinSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const updates = parseResult.data

  const { data, error } = await supabase
    .from('pinned_items')
    .update(updates)
    .eq('id', params.pinId)
    .select()
    .single()
  if (error || !data) return apiError('INTERNAL_ERROR', error?.message ?? 'Failed to update pin', 500)

  return apiSuccess(data)
}
