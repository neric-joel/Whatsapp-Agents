import { getDb, nowIso, rowToSession } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, internalError } from '@/lib/api-security'
import { updateSessionSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'

export const runtime = 'nodejs'

/** Rename a session and/or mark it active (touch last_active_at when switching). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const { id } = await params
  const body = await req.json().catch(() => null)
  const parsed = updateSessionSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid update', 400, parsed.error.flatten())
  }

  const db = getDb()
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id)
  if (!existing) return apiError('NOT_FOUND', 'Session not found', 404)

  try {
    const sets: string[] = []
    const args: unknown[] = []
    if (parsed.data.name !== undefined) {
      sets.push('name = ?')
      args.push(parsed.data.name.trim())
    }
    if (parsed.data.touch) {
      sets.push('last_active_at = ?')
      args.push(nowIso())
    }
    if (sets.length > 0) {
      args.push(id)
      db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...args)
    }
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Record<string, unknown>
    return apiSuccess(rowToSession(row))
  } catch (e) {
    return internalError('session update', e)
  }
}
