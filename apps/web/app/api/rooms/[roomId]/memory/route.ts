import { getDb, intBool, newId, rowToMemoryEntry } from '@agentroom/db'
import { scanMemoryContent } from '@agentroom/shared'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createMemorySchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: Promise<{ roomId: string }>
}

const RECALL_LIMIT = 50

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
 * GET — list/recall memory for the room. With `?q=`, runs ranked recall (the
 * `/recall` command); without it, lists the most relevant active memory for the
 * Memory panel. Returns room-shared notes, every agent's room memory, and the
 * caller's personal global notes (membership/ownership enforced in SQL).
 */
export async function GET(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''

  try {
    const db = getDb()
    // SQLite reimplementation of the former Postgres `recall_agent_memory` RPC
    // (p_agent_id = null). Active memory visible to this room: room-shared notes
    // (or any agent's room memory) + the caller's personal global notes.
    const rows = db
      .prepare(
        `SELECT * FROM agent_memory m
         WHERE m.is_active = 1
           AND (
             (m.scope = 'room' AND m.room_id = ?)
             OR (m.scope = 'global' AND m.created_by_user_id = ?)
           )`,
      )
      .all(params.roomId, auth.user.id)
      .map((r) => rowToMemoryEntry(r as Record<string, unknown>))

    // When a query string is given, keep only rows whose title/content contain a
    // query term (the LIKE analog of the former `search_tsv @@ tsquery` filter),
    // and prefer rows matching more terms — mirroring the ranked RPC.
    const terms = q
      ? q
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0)
      : []
    const hasQuery = terms.length > 0
    const score = (row: (typeof rows)[number]): number => {
      if (!hasQuery) return 0
      const haystack = `${row.title ?? ''} ${row.content}`.toLowerCase()
      let n = 0
      for (const term of terms) {
        if (haystack.includes(term)) n += 1
      }
      return n
    }

    const filtered = hasQuery ? rows.filter((row) => score(row) > 0) : rows

    filtered.sort((a, b) => {
      // pinned DESC
      const pinnedDiff = Number(b.pinned) - Number(a.pinned)
      if (pinnedDiff !== 0) return pinnedDiff
      // query-rank DESC (0 when no query)
      const rankDiff = score(b) - score(a)
      if (rankDiff !== 0) return rankDiff
      // confidence DESC
      const confDiff = b.confidence - a.confidence
      if (confDiff !== 0) return confDiff
      // created_at DESC (ISO-8601 text sorts lexicographically)
      if (a.created_at < b.created_at) return 1
      if (a.created_at > b.created_at) return -1
      return 0
    })

    return apiSuccess(filtered.slice(0, RECALL_LIMIT))
  } catch (e) {
    return internalError('memory recall', e)
  }
}

/**
 * POST — `/remember`. Stores a user-authored memory. Content is injection-scanned
 * + sanitized before it lands (the same scan the bridge applies to agent memory).
 * The browser never writes the table directly — this server route writes the local
 * data layer after an authn + membership check.
 */
export async function POST(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const limited = enforceRateLimit(`memory:${auth.user.id}:${params.roomId}`, 30, 60_000)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = createMemorySchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }
  const input = parsed.data
  const scope = input.scope ?? 'room'
  const scan = scanMemoryContent(input.content)
  const title = input.title ? scanMemoryContent(input.title).sanitized.slice(0, 200) : null

  try {
    const db = getDb()
    const created = db
      .prepare(
        `INSERT INTO agent_memory
           (id, agent_id, room_id, scope, kind, title, content, created_by_user_id, injection_flagged)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        newId(),
        null,
        scope === 'room' ? params.roomId : null,
        scope,
        input.kind ?? 'fact',
        title,
        scan.sanitized,
        auth.user.id,
        intBool(scan.flagged),
      ) as Record<string, unknown> | undefined
    if (!created) return internalError('memory create', new Error('insert returned no row'))

    return apiSuccess(rowToMemoryEntry(created), 201)
  } catch (e) {
    return internalError('memory create', e)
  }
}
