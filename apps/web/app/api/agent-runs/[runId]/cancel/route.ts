import { NextRequest } from 'next/server'

import {
  type AgentRunStatus,
  buildCancelledRunPatch,
  isCancellableRunStatus,
} from '@/lib/agent-run-cancellation'
import { apiError, apiSuccess } from '@/lib/api-error'
import { requireRoomMember } from '@/lib/permissions'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

interface RouteParams {
  params: { runId: string }
}

interface AgentRunRow {
  id: string
  room_id: string
  status: AgentRunStatus
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data: runRaw } = await supabase
    .from('agent_runs')
    .select('id, room_id, status')
    .eq('id', params.runId)
    .single()

  if (!runRaw) return apiError('NOT_FOUND', 'Agent run not found', 404)
  const run = runRaw as AgentRunRow

  try {
    await requireRoomMember(supabase, run.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  if (!isCancellableRunStatus(run.status)) {
    return apiError('CONFLICT', 'Agent run is not running', 409)
  }

  const { data, error } = await supabase
    .from('agent_runs')
    .update(buildCancelledRunPatch())
    .eq('id', params.runId)
    .in('status', ['queued', 'claimed', 'running'])
    .select()
    .single()

  if (error || !data) return apiError('CONFLICT', error?.message ?? 'Agent run is not running', 409)

  return apiSuccess(data)
}
