import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { addRoomAgentSchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams {
  params: { roomId: string }
}

type AgentRow = {
  id: string
  name: string
  slug: string
  provider: string
  adapter_type: string
  is_active: boolean
}

type RoomAgentMemberRow = {
  id: string
  room_id: string
  agent_id: string
  member_type: 'agent'
  reply_enabled: boolean
  muted: boolean
  joined_at: string
  agents: AgentRow
}

type AgentRunStatusRow = {
  agent_id: string
  status: string
  created_at: string
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

async function addLatestRunStatus(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  roomId: string,
  members: RoomAgentMemberRow[],
) {
  const agentIds = members.map((member) => member.agent_id)
  if (agentIds.length === 0) return members.map(formatMember)

  const { data } = await supabase
    .from('agent_runs')
    .select('agent_id, status, created_at')
    .eq('room_id', roomId)
    .in('agent_id', agentIds)
    .order('created_at', { ascending: false })

  const latestStatusByAgent = new Map<string, string>()
  for (const run of (data ?? []) as AgentRunStatusRow[]) {
    if (!latestStatusByAgent.has(run.agent_id)) latestStatusByAgent.set(run.agent_id, run.status)
  }

  return members.map((member) => ({
    ...formatMember(member),
    last_run_status: latestStatusByAgent.get(member.agent_id) ?? null,
  }))
}

function formatMember(member: RoomAgentMemberRow) {
  const { agents, ...rest } = member
  return {
    ...rest,
    agent: agents,
    last_run_status: null,
  }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const { data, error } = await auth.supabase
    .from('room_members')
    .select(memberSelect)
    .eq('room_id', params.roomId)
    .eq('member_type', 'agent')
    .order('joined_at')

  if (error) return internalError('room members list', error)

  const members = await addLatestRunStatus(
    auth.supabase,
    params.roomId,
    (data ?? []) as unknown as RoomAgentMemberRow[],
  )

  return apiSuccess(members)
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = addRoomAgentSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }

  const { data: agent, error: agentErr } = await auth.supabase
    .from('agents')
    .select('id')
    .eq('id', parseResult.data.agentId)
    .single()

  if (agentErr || !agent) return apiError('NOT_FOUND', 'Agent not found', 404)

  const { data, error } = await auth.supabase
    .from('room_members')
    .insert({
      room_id: params.roomId,
      agent_id: parseResult.data.agentId,
      member_type: 'agent',
      reply_enabled: true,
      muted: false,
    })
    .select(memberSelect)
    .single()

  if (error) {
    if (error.code === '23505') return apiError('CONFLICT', 'Agent is already in the room', 409)
    return internalError('room members add agent', error)
  }

  const members = await addLatestRunStatus(auth.supabase, params.roomId, [
    data as unknown as RoomAgentMemberRow,
  ])

  return apiSuccess(members[0], 201)
}
