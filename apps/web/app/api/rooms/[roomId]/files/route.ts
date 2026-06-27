import { getDb, rowToFile } from '@agentroom/db'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: { roomId: string }
}

/**
 * Lists a room's uploaded files (metadata only) so the timeline can render
 * attachment cards. Read-only.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  try {
    await requireRoomMember(params.roomId, user.id)
  } catch (e) {
    return e as Response
  }

  try {
    const rows = getDb()
      .prepare('SELECT * FROM files WHERE room_id = ? ORDER BY created_at DESC')
      .all(params.roomId) as Record<string, unknown>[]
    return apiSuccess(rows.map(rowToFile))
  } catch (e) {
    return internalError('room files list', e)
  }
}
