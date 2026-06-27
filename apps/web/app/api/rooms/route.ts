import { getDb, newId, rowToRoom } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { createRoomSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  // 1. Authenticate
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  // 2. List non-archived rooms for the sidebar (most recently active first)
  const db = getDb()
  try {
    const rows = db
      .prepare(
        `SELECT * FROM rooms
         WHERE is_archived = 0
         ORDER BY (last_message_at IS NULL), last_message_at DESC, created_at DESC`,
      )
      .all() as Record<string, unknown>[]
    const rooms = rows.map(rowToRoom)
    return apiSuccess(rooms)
  } catch (e) {
    return internalError('rooms list', e)
  }
}

export async function POST(req: NextRequest) {
  // 1. Authenticate
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  // 2. Parse body
  const body = await req.json().catch(() => null)
  const parseResult = createRoomSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const data = parseResult.data
  const name = data.name.trim()
  if (!name) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, {
      fieldErrors: { name: ['name is required'] },
    })
  }

  const db = getDb()

  try {
    // 3. Insert room (attached to the active session if one was provided)
    const sessionId = data.session_id ?? null
    const room = db
      .prepare(
        `INSERT INTO rooms (id, name, room_type, reply_mode, discussion_mode, visibility, session_id, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        newId(),
        name,
        data.room_type ?? 'group',
        data.reply_mode === 'all' ? 'everyone' : (data.reply_mode ?? 'everyone'),
        data.discussion_mode ?? 'independent',
        data.visibility ?? 'private',
        sessionId,
        user.id,
      ) as Record<string, unknown> | undefined

    if (!room) return internalError('rooms create room', new Error('insert returned no row'))

    // Touch the session so it sorts as the active one.
    if (sessionId) {
      try {
        db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(
          new Date().toISOString(),
          sessionId,
        )
      } catch {
        /* non-fatal */
      }
    }

    // 4. Insert creator as owner member
    db.prepare(
      `INSERT INTO room_members (id, room_id, member_type, user_id, role)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(newId(), room.id, 'user', user.id, 'owner')

    return apiSuccess(rowToRoom(room), 201)
  } catch (e) {
    return internalError('rooms create room', e)
  }
}
