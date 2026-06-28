import { getDb, intBool, rowToPinnedItem } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { updatePinSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: Promise<{ pinId: string }>
}

export async function PATCH(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()

  const pin = db.prepare('SELECT id, room_id FROM pinned_items WHERE id = ?').get(params.pinId) as
    | { id: string; room_id: string }
    | undefined
  if (!pin) return apiError('NOT_FOUND', 'Pin not found', 404)

  try {
    await requireRoomMember(pin.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  const body = await req.json().catch(() => null)
  const parseResult = updatePinSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const updates = parseResult.data

  try {
    // Build the SET clause from the provided fields only. `is_active` is stored as
    // INTEGER 0/1 in SQLite, so it goes through intBool(); `sort_order` is a plain int.
    const sets: string[] = []
    const vals: unknown[] = []

    if (updates.is_active !== undefined) {
      sets.push('is_active = ?')
      vals.push(intBool(updates.is_active))
    }
    if (updates.sort_order !== undefined) {
      sets.push('sort_order = ?')
      vals.push(updates.sort_order)
    }

    const data = db
      .prepare(`UPDATE pinned_items SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
      .get(...vals, params.pinId) as Record<string, unknown> | undefined
    if (!data) return internalError('pins update', new Error('update returned no row'))

    return apiSuccess(rowToPinnedItem(data))
  } catch (e) {
    return internalError('pins update', e)
  }
}
