import { getDb, intBool, rowToRoom } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { updateRoomSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomOwner } from '@/lib/permissions'

interface RouteParams {
  params: { roomId: string }
}

async function requireAuthenticatedRoomOwner(req: NextRequest, roomId: string) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  try {
    await requireRoomOwner(roomId, user.id)
  } catch (e) {
    return { error: e as Response }
  }

  return { user }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomOwner(req, params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = updateRoomSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }

  const sets: string[] = []
  const args: unknown[] = []
  if (parseResult.data.name !== undefined) {
    sets.push('name = ?')
    args.push(parseResult.data.name.trim())
  }
  if (parseResult.data.is_archived !== undefined) {
    sets.push('is_archived = ?')
    args.push(intBool(parseResult.data.is_archived))
  }
  args.push(params.roomId)

  const db = getDb()
  let data: Record<string, unknown> | undefined
  try {
    data = db
      .prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
      .get(...args) as Record<string, unknown> | undefined
  } catch (e) {
    return internalError('room update', e)
  }

  if (!data) return internalError('room update', null)

  return apiSuccess(rowToRoom(data))
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomOwner(req, params.roomId)
  if ('error' in auth) return auth.error

  const db = getDb()
  try {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(params.roomId)
  } catch (e) {
    return internalError('room delete', e)
  }

  return apiSuccess({ deleted: true })
}
