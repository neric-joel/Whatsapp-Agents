import { NextRequest } from 'next/server'

import {
  type AgentRunStatus,
  buildCancelledRunPatch,
  isCancellableRunStatus,
} from '@/lib/agent-run-cancellation'
import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'
import { getDb, rowToAgentRun } from '@agentroom/db'

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

  const db = getDb()

  let runRaw: AgentRunRow | undefined
  try {
    runRaw = db
      .prepare('SELECT id, room_id, status FROM agent_runs WHERE id = ?')
      .get(params.runId) as AgentRunRow | undefined
  } catch (e) {
    return internalError('agent-runs.cancel.lookup', e)
  }

  if (!runRaw) return apiError('NOT_FOUND', 'Agent run not found', 404)
  const run = runRaw

  try {
    await requireRoomMember(run.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  if (!isCancellableRunStatus(run.status)) {
    return apiError('CONFLICT', 'Agent run is not running', 409)
  }

  const patch = buildCancelledRunPatch()

  let updated: Record<string, unknown> | undefined
  try {
    updated = db
      .prepare(
        `UPDATE agent_runs
            SET status = ?, error_message = ?, completed_at = ?
          WHERE id = ? AND status IN ('queued', 'claimed', 'running')
        RETURNING *`,
      )
      .get(patch.status, patch.error_message, patch.completed_at, params.runId) as
      | Record<string, unknown>
      | undefined
  } catch (e) {
    return internalError('agent-runs.cancel.update', e)
  }

  if (!updated) return apiError('CONFLICT', 'Agent run is not running', 409)

  return apiSuccess(rowToAgentRun(updated))
}
