import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getAuthenticatedUser } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, internalError } from '@/lib/api-security'
import { canCurrentUserDeleteMessage, createDeletedMessagePatch } from '@/lib/message-management'
import { stripServerOwnedMetadata } from '@/lib/message-metadata'
import { requireRoomMember } from '@/lib/permissions'
import { getDb, jsonText, rowToMessage } from '@agentroom/db'

interface RouteParams {
  params: { roomId: string; messageId: string }
}

// PATCH body: edit a message's content and/or metadata. At least one field required.
const updateMessageSchema = z
  .object({
    content: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, 'At least one field required')

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { roomId, messageId } = params

  // 0. CSRF defense for cookie-authed mutations.
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()
  try {
    await requireRoomMember(roomId, user.id)
  } catch (e) {
    return e as Response
  }

  // Parse + validate body
  const body = await req.json().catch(() => null)
  const parseResult = updateMessageSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }
  const data = parseResult.data

  try {
    const existing = db
      .prepare('SELECT * FROM messages WHERE id = ? AND room_id = ?')
      .get(messageId, roomId) as Record<string, unknown> | undefined
    if (!existing) return apiError('NOT_FOUND', 'Message not found', 404)

    // Build the SET clause from the provided fields only.
    const sets: string[] = []
    const vals: unknown[] = []

    if (data.content !== undefined) {
      sets.push('content = ?')
      vals.push(data.content)
    }

    if (data.metadata !== undefined) {
      // SECURITY: merge the client patch over existing metadata, but the server is the SOLE
      // author of `metadata.discussion` — strip it from the client-supplied block before merging
      // (see stripServerOwnedMetadata) so the existing trusted block is preserved.
      const current = rowToMessage(existing).metadata
      const nextMetadata = {
        ...current,
        ...stripServerOwnedMetadata(data.metadata),
      }
      sets.push('metadata = ?')
      vals.push(jsonText(nextMetadata))
    }

    const updated = db
      .prepare(
        `UPDATE messages SET ${sets.join(', ')} WHERE id = ? AND room_id = ? RETURNING *`,
      )
      .get(...vals, messageId, roomId) as Record<string, unknown> | undefined

    if (!updated) return internalError('message update', new Error('update returned no row'))

    return apiSuccess({ message: rowToMessage(updated) })
  } catch (e) {
    return internalError('message update', e)
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { roomId, messageId } = params
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()
  try {
    await requireRoomMember(roomId, user.id)
  } catch (e) {
    return e as Response
  }

  try {
    const message = db
      .prepare('SELECT id, sender_type, sender_user_id FROM messages WHERE id = ? AND room_id = ?')
      .get(messageId, roomId) as
      | { id: string; sender_type: string; sender_user_id: string | null }
      | undefined

    if (!message) return apiError('NOT_FOUND', 'Message not found', 404)
    if (!canCurrentUserDeleteMessage(message, user.id)) {
      return apiError('FORBIDDEN', 'You can only delete your own messages', 403)
    }

    const patch = createDeletedMessagePatch()
    const deletedMessage = db
      .prepare('UPDATE messages SET content = ? WHERE id = ? AND room_id = ? RETURNING id, content')
      .get(patch.content, messageId, roomId) as { id: string; content: string } | undefined

    if (!deletedMessage) {
      return internalError('message delete update', new Error('update returned no row'))
    }

    return apiSuccess({ message: deletedMessage })
  } catch (e) {
    return internalError('message delete', e)
  }
}
