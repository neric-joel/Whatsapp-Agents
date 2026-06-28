import { getDb, nowIso, rowToToolCall } from '@agentroom/db'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: Promise<{ toolCallId: string }>
}

export async function POST(req: Request, props: RouteParams) {
  const params = await props.params
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()
  try {
    const toolCall = db
      .prepare('SELECT id, room_id FROM tool_calls WHERE id = ?')
      .get(params.toolCallId) as { id: string; room_id: string } | undefined
    if (!toolCall) return apiError('NOT_FOUND', 'Tool call not found', 404)

    try {
      await requireRoomMember(toolCall.room_id, user.id)
    } catch (e) {
      return e as Response
    }

    const updated = db
      .prepare(
        `UPDATE tool_calls SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ? AND status = 'waiting_approval' RETURNING *`,
      )
      .get(user.id, nowIso(), params.toolCallId) as Record<string, unknown> | undefined
    if (!updated) return apiError('CONFLICT', 'Tool call is not waiting for approval', 400)

    return apiSuccess(rowToToolCall(updated))
  } catch (e) {
    return internalError('tool call approve', e)
  }
}
