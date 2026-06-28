import { getDb, rowToToolCall } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: Promise<{ roomId: string }>
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
 * Lists the most recent tool calls for a room (the agent tool-use history) so the UI
 * can show tool activity/approvals. Read-only; capped at 200, newest first.
 */
export async function GET(req: Request, props: RouteParams) {
  const params = await props.params
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const db = getDb()
  try {
    const rows = db
      .prepare(
        `SELECT * FROM tool_calls WHERE room_id = ?
           AND status IN ('waiting_approval','approved','running','succeeded','failed','denied')
         ORDER BY created_at ASC`,
      )
      .all(params.roomId) as Record<string, unknown>[]
    const toolCalls = rows.map(rowToToolCall)
    return apiSuccess(toolCalls)
  } catch (e) {
    return internalError('room tool-calls list', e)
  }
}
