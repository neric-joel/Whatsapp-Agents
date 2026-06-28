import { getDb, jsonText, newId, nowIso } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { requireRoomAdmin } from '@/lib/permissions'

interface RouteParams {
  params: Promise<{ roomId: string }>
}

/**
 * Phase 11 `/reset` (admin+). Clears the room's rolling agent context by
 * stamping `context_reset_at` — the bridge then only feeds agents messages
 * created at/after this moment. Messages are NOT deleted; the transcript stays
 * intact and the action is reversible. RBAC is enforced here, server-side, so a
 * plain `member` cannot reset even if the command were not hidden in the UI.
 */
export async function POST(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const { roomId } = params

  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`reset:${user.id}:${roomId}`, 10, 60_000)
  if (limited) return limited

  const db = getDb()
  try {
    await requireRoomAdmin(roomId, user.id)
  } catch (e) {
    return e as Response
  }

  const now = nowIso()
  try {
    db.prepare('UPDATE rooms SET context_reset_at = ? WHERE id = ?').run(now, roomId)
  } catch (e) {
    return internalError('room context reset', e)
  }

  // Best-effort transcript notice — the reset itself already succeeded above.
  try {
    db.prepare(
      `INSERT INTO messages (id, room_id, sender_type, content, content_type, mentions, target_agent_ids, round_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId(),
      roomId,
      'system',
      'Agent context was reset by an admin. Agents start fresh from here.',
      'text',
      jsonText([]),
      jsonText([]),
      0,
    )
  } catch (e) {
    logger.error('room.reset.notice_failed', {
      room_id: roomId,
      error: e instanceof Error ? e.message : String(e),
    })
  }

  return apiSuccess({ context_reset_at: now })
}
