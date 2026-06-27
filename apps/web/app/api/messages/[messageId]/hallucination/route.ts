import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDb, jsonText, newId } from '@agentroom/db'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: { messageId: string }
}

const bodySchema = z.object({
  accepted: z.boolean(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return isRecord(value) ? value : {}
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const { messageId } = params

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const body = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }

  const db = getDb()

  let message: { id: string; room_id: string; metadata: unknown; round_index: number } | undefined
  try {
    message = db
      .prepare('SELECT id, room_id, metadata, round_index FROM messages WHERE id = ?')
      .get(messageId) as
      | { id: string; room_id: string; metadata: unknown; round_index: number }
      | undefined
  } catch (e) {
    return internalError('hallucination fetch message', e)
  }

  if (!message) return apiError('NOT_FOUND', 'Message not found', 404)

  try {
    await requireRoomMember(message.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  const metadata = parseMetadata(message.metadata)
  const hallucination = isRecord(metadata.hallucination) ? metadata.hallucination : {}
  const nextMetadata = {
    ...metadata,
    hallucination: {
      ...hallucination,
      accepted: parsed.data.accepted,
      flagged: false,
    },
  }

  try {
    db.prepare('UPDATE messages SET metadata = ? WHERE id = ?').run(jsonText(nextMetadata), messageId)
  } catch (e) {
    return internalError('hallucination update metadata', e)
  }

  if (!parsed.data.accepted) {
    try {
      db.prepare(
        `INSERT INTO messages (id, room_id, sender_type, content, content_type, round_index, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        message.room_id,
        'system',
        'User rejected this response as potentially inaccurate.',
        'text',
        message.round_index ?? 0,
        jsonText({ hallucination_rejection_for: messageId }),
      )
    } catch (e) {
      return internalError('hallucination insert system message', e)
    }
  }

  return apiSuccess({ updated: true })
}
