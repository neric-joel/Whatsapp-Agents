import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { updateRoomAgentMemberSchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams {
  params: { roomId: string; memberId: string }
}

const memberSelect = `
  id,
  room_id,
  agent_id,
  member_type,
  reply_enabled,
  muted,
  joined_at,
  agents!inner(id, name, slug, provider, adapter_type, is_active)
`

async function requireAuthenticatedRoomMember(req: NextRequest, roomId: string) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomMember(supabase, roomId, user.id)
  } catch (e) {
    return { error: e as Response }
  }

  return { supabase }
}

function formatMember(row: { agents: unknown; [key: string]: unknown }) {
  const { agents, ...rest } = row
  return {
    ...rest,
    agent: agents,
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const { error } = await auth.supabase
    .from('room_members')
    .delete()
    .eq('id', params.memberId)
    .eq('room_id', params.roomId)
    .eq('member_type', 'agent')

  if (error) return internalError('room member delete', error)

  return apiSuccess({ deleted: true })
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = updateRoomAgentMemberSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }

  const { data, error } = await auth.supabase
    .from('room_members')
    .update(parseResult.data)
    .eq('id', params.memberId)
    .eq('room_id', params.roomId)
    .eq('member_type', 'agent')
    .select(memberSelect)
    .single()

  if (error || !data) return apiError('NOT_FOUND', 'Room member not found', 404)

  return apiSuccess(formatMember(data as unknown as { agents: unknown; [key: string]: unknown }))
}
