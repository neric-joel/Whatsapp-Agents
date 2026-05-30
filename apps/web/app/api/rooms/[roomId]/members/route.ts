import { NextRequest } from 'next/server'
import { apiError, apiSuccess } from '@/lib/api-error'
import { addRoomAgentSchema } from '@/lib/api-validation'
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
    .from('room_members')
    .select('*, agents(id, slug, name)')
    .eq('room_id', params.roomId)
    .order('joined_at', { ascending: true })

  if (error) return apiError('INTERNAL_ERROR', error.message, 500)

  return apiSuccess(data ?? [])
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = addRoomAgentSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }

  const { agent_id: agentId } = parseResult.data

  const { data: agent, error: agentErr } = await auth.supabase
    .from('agents')
    .select('id, slug, name, is_active')
    .eq('id', agentId)
    .eq('is_active', true)
    .maybeSingle()

  if (agentErr) return apiError('INTERNAL_ERROR', agentErr.message, 500)
  if (!agent) return apiError('NOT_FOUND', 'Agent not found', 404)

  const { data: existing, error: existingErr } = await auth.supabase
    .from('room_members')
    .select('id')
    .eq('room_id', params.roomId)
    .eq('agent_id', agentId)
    .maybeSingle()

  if (existingErr) return apiError('INTERNAL_ERROR', existingErr.message, 500)
  if (existing) return apiError('CONFLICT', 'Agent is already in this room', 409)

  const { data, error } = await auth.supabase
    .from('room_members')
    .insert({
      room_id: params.roomId,
      agent_id: agentId,
      member_type: 'agent',
      role: 'member',
      reply_enabled: true,
      muted: false,
    })
    .select('*, agents(id, slug, name)')
    .single()

  if (error || !data) {
    const status = error?.code === '23505' ? 409 : 500
    const code = status === 409 ? 'CONFLICT' : 'INTERNAL_ERROR'
    return apiError(code, error?.message ?? 'Failed to add agent', status)
  }

  return apiSuccess(data, 201)
}
