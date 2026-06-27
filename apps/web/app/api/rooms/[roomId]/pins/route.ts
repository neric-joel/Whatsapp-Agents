import { getDb, newId, rowToPinnedItem } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { createPinSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
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

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const db = getDb()
  try {
    const rows = db
      .prepare(
        'SELECT * FROM pinned_items WHERE room_id = ? AND is_active = 1 ORDER BY sort_order, created_at',
      )
      .all(params.roomId) as Record<string, unknown>[]
    const pins = rows.map(rowToPinnedItem)
    return apiSuccess(pins)
  } catch (e) {
    return internalError('room pins list', e)
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = createPinSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const pinData = parseResult.data

  const db = getDb()
  try {
    const row = db
      .prepare(
        `INSERT INTO pinned_items (id, room_id, message_id, pin_type, title, content, visibility, pinned_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        newId(),
        params.roomId,
        pinData.source_message_id ?? null,
        pinData.pin_type,
        pinData.title ?? null,
        pinData.content ?? null,
        pinData.visibility ?? 'primary',
        auth.user.id,
      ) as Record<string, unknown> | undefined
    if (!row) return internalError('room pins create', new Error('insert returned no row'))

    return apiSuccess(rowToPinnedItem(row), 201)
  } catch (e) {
    return internalError('room pins create', e)
  }
}
