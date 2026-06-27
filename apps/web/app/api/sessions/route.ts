import { basename } from 'node:path'

import { getDb, newId, rowToSession, validateWorkingDir } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createSessionSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'

export const runtime = 'nodejs'

/** List sessions, most-recently-active first (the first is the active one). */
export async function GET(req: NextRequest) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)
  try {
    const rows = getDb()
      .prepare('SELECT * FROM sessions ORDER BY last_active_at DESC, created_at DESC')
      .all() as Record<string, unknown>[]
    return apiSuccess(rows.map(rowToSession))
  } catch (e) {
    return internalError('sessions list', e)
  }
}

/**
 * Create a session bound to a working folder. The folder is an absolute path on this
 * machine (local app), validated to exist + be a directory — the local analog of
 * Cowork's "use an existing folder on your computer". Auto-names from the folder if no
 * name is given.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit('session-create', 30, 60_000)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = createSessionSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid session', 400, parsed.error.flatten())
  }
  const input = parsed.data

  // Harden the working folder before it is stored (issue #67): absolute, no UNC/device
  // paths, realpath inside the allow-root, a real directory — defeats traversal + symlink
  // escape. The canonical path is what gets persisted and (eventually) used as a spawn cwd.
  const check = validateWorkingDir(input.working_dir)
  if (!check.ok || !check.path) {
    return apiError('VALIDATION_ERROR', check.reason ?? 'Invalid working_dir', 400)
  }
  const abs = check.path

  const name =
    input.name?.trim() || `${basename(abs) || abs} · ${new Date().toISOString().slice(0, 10)}`

  try {
    const row = getDb()
      .prepare(
        `INSERT INTO sessions (id, name, working_dir, created_by_user_id) VALUES (?, ?, ?, ?) RETURNING *`,
      )
      .get(newId(), name, abs, user.id) as Record<string, unknown> | undefined
    if (!row) return internalError('session create', new Error('insert returned no row'))
    return apiSuccess(rowToSession(row), 201)
  } catch (e) {
    return internalError('session create', e)
  }
}
