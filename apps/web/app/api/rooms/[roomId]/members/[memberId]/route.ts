import { NextRequest } from 'next/server'

import { getDb, intBool, rowToRoomMember } from '@agentroom/db'

import { getAuthenticatedUser } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { updateRoomAgentMemberSchema } from '@/lib/api-validation'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: { roomId: string; memberId: string }
}

async function requireAuthenticatedRoomMember(req: NextRequest, roomId: string) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  try {
    await requireRoomMember(roomId, user.id)
  } catch (e) {
    return { error: e as Response }
  }

  return { user }
}

/**
 * Loads an agent room member by id (scoped to the room) and returns it in the same
 * nested shape the old Supabase `agents!inner(...)` select produced: the member row
 * with a nested `agent` object. Returns null when the member is missing.
 */
function loadAgentMember(roomId: string, memberId: string) {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT m.id, m.room_id, m.agent_id, m.member_type, m.reply_enabled, m.muted, m.joined_at,
              m.user_id, m.role, m.created_at, m.updated_at,
              a.id AS agent__id, a.name AS agent__name, a.slug AS agent__slug,
              a.provider AS agent__provider, a.adapter_type AS agent__adapter_type,
              a.is_active AS agent__is_active
       FROM room_members m
       INNER JOIN agents a ON a.id = m.agent_id
       WHERE m.id = ? AND m.room_id = ? AND m.member_type = 'agent'`
    )
    .get(memberId, roomId) as Record<string, unknown> | undefined
  if (!row) return null

  const member = rowToRoomMember(row)
  return {
    id: member.id,
    room_id: member.room_id,
    agent_id: member.agent_id,
    member_type: member.member_type,
    reply_enabled: member.reply_enabled,
    muted: member.muted,
    joined_at: member.joined_at,
    agent: {
      id: row['agent__id'],
      name: row['agent__name'],
      slug: row['agent__slug'],
      provider: row['agent__provider'],
      adapter_type: row['agent__adapter_type'],
      is_active: row['agent__is_active'] === 1,
    },
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const db = getDb()
  try {
    db.prepare(
      `DELETE FROM room_members WHERE id = ? AND room_id = ? AND member_type = 'agent'`
    ).run(params.memberId, params.roomId)
  } catch (e) {
    return internalError('room member delete', e)
  }

  return apiSuccess({ deleted: true })
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = updateRoomAgentMemberSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }

  const { reply_enabled, muted } = parseResult.data
  const sets: string[] = []
  const values: unknown[] = []
  if (reply_enabled !== undefined) {
    sets.push('reply_enabled = ?')
    values.push(intBool(reply_enabled))
  }
  if (muted !== undefined) {
    sets.push('muted = ?')
    values.push(intBool(muted))
  }

  const db = getDb()
  try {
    db.prepare(
      `UPDATE room_members SET ${sets.join(', ')} WHERE id = ? AND room_id = ? AND member_type = 'agent'`
    ).run(...values, params.memberId, params.roomId)
  } catch (e) {
    return internalError('room member update', e)
  }

  const data = loadAgentMember(params.roomId, params.memberId)
  if (!data) return apiError('NOT_FOUND', 'Room member not found', 404)

  return apiSuccess(data)
}
