import { NextRequest } from 'next/server'

import { getAuthenticatedUser } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { updateMemorySchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'
import { getDb, intBool, rowToMemoryEntry } from '@agentroom/db'

interface RouteParams {
  params: { memoryId: string }
}

/**
 * PATCH — pin / forget (set `is_active` / `pinned`) a memory entry. Allowed for a
 * member of the memory's room, or the owner of a personal global note. Local
 * single-user: the authz gate always passes for a room-scoped note, and personal
 * notes are owned by the one local user.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`memory-patch:${user.id}`, 60, 60_000)
  if (limited) return limited

  const db = getDb()

  const mem = db
    .prepare('SELECT id, room_id, created_by_user_id FROM agent_memory WHERE id = ?')
    .get(params.memoryId) as
    | { id: string; room_id: string | null; created_by_user_id: string | null }
    | undefined
  if (!mem) return apiError('NOT_FOUND', 'Memory not found', 404)

  if (mem.room_id) {
    try {
      await requireRoomMember(mem.room_id, user.id)
    } catch (e) {
      return e as Response
    }
  } else if (mem.created_by_user_id !== user.id) {
    return apiError('FORBIDDEN', 'Not allowed to modify this memory', 403)
  }

  const body = await req.json().catch(() => null)
  const parsed = updateMemorySchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }

  try {
    // Build the SET clause from the provided fields only. Both columns are stored as
    // INTEGER 0/1 in SQLite, so booleans go through intBool().
    const sets: string[] = []
    const vals: unknown[] = []

    if (parsed.data.is_active !== undefined) {
      sets.push('is_active = ?')
      vals.push(intBool(parsed.data.is_active))
    }
    if (parsed.data.pinned !== undefined) {
      sets.push('pinned = ?')
      vals.push(intBool(parsed.data.pinned))
    }

    const updated = db
      .prepare(`UPDATE agent_memory SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
      .get(...vals, params.memoryId) as Record<string, unknown> | undefined
    if (!updated) return internalError('memory update', new Error('update returned no row'))

    return apiSuccess(rowToMemoryEntry(updated))
  } catch (e) {
    return internalError('memory update', e)
  }
}
