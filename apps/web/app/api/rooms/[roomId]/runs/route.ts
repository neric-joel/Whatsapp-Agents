import { NextRequest } from 'next/server'

import { getDb, rowToAgentRun } from '@agentroom/db'

import { getAuthenticatedUser } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: { roomId: string }
}

async function requireAuthenticatedRoomMember(req: NextRequest | Request, roomId: string) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req as { headers: Headers })
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  try {
    await requireRoomMember(roomId, user.id)
  } catch (e) {
    return { error: e as Response }
  }

  return { user }
}

/**
 * Lists the most recent agent runs for a room (the work queue history) so the UI
 * can show run status/activity. Read-only; capped at 200, newest first.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const db = getDb()
  try {
    const rows = db
      .prepare(
        `SELECT r.*, a.name AS agent_name, a.provider AS agent_provider
         FROM agent_runs r LEFT JOIN agents a ON a.id = r.agent_id
         WHERE r.room_id = ?
           AND r.status IN ('queued','claimed','running','failed','cancelled')
         ORDER BY r.created_at ASC`,
      )
      .all(params.roomId) as Record<string, unknown>[]
    const runs = rows.map((row) => ({
      ...rowToAgentRun(row),
      agents: row['agent_name']
        ? { name: String(row['agent_name']), provider: String(row['agent_provider']) }
        : null,
    }))
    return apiSuccess(runs)
  } catch (e) {
    return internalError('room runs list', e)
  }
}
