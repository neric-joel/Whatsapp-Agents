import { getDb, intBool, newId } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { internalError } from '@/lib/api-security'
import { addRoomAgentSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomMember } from '@/lib/permissions'

interface RouteParams {
  params: Promise<{ roomId: string }>
}

type AgentRow = {
  id: string
  name: string
  slug: string
  provider: string
  adapter_type: string
  is_active: boolean
}

// Flat row shape returned by the room_members + agents JOIN. SQLite stores booleans
// as INTEGER 0/1, so member/agent booleans arrive as numbers and are rehydrated below.
type RoomAgentMemberJoinRow = {
  id: string
  room_id: string
  agent_id: string
  member_type: 'agent'
  reply_enabled: number
  muted: number
  joined_at: string
  agent_id_a: string
  agent_name: string
  agent_slug: string
  agent_provider: string
  agent_adapter_type: string
  agent_is_active: number
}

type FormattedMember = {
  id: string
  room_id: string
  agent_id: string
  member_type: 'agent'
  reply_enabled: boolean
  muted: boolean
  joined_at: string
  agent: AgentRow
  last_run_status: string | null
}

// SELECT room_members for the room joined to agents. Mirrors the old
// `agents!inner(...)` nested select; aliases keep the agent columns distinct.
const MEMBER_SELECT = `
  SELECT
    m.id            AS id,
    m.room_id       AS room_id,
    m.agent_id      AS agent_id,
    m.member_type   AS member_type,
    m.reply_enabled AS reply_enabled,
    m.muted         AS muted,
    m.joined_at     AS joined_at,
    a.id            AS agent_id_a,
    a.name          AS agent_name,
    a.slug          AS agent_slug,
    a.provider      AS agent_provider,
    a.adapter_type  AS agent_adapter_type,
    a.is_active     AS agent_is_active
  FROM room_members m
  INNER JOIN agents a ON a.id = m.agent_id
`

function formatMember(row: RoomAgentMemberJoinRow): FormattedMember {
  return {
    id: row.id,
    room_id: row.room_id,
    agent_id: row.agent_id,
    member_type: row.member_type,
    reply_enabled: row.reply_enabled === 1,
    muted: row.muted === 1,
    joined_at: row.joined_at,
    agent: {
      id: row.agent_id_a,
      name: row.agent_name,
      slug: row.agent_slug,
      provider: row.agent_provider,
      adapter_type: row.agent_adapter_type,
      is_active: row.agent_is_active === 1,
    },
    last_run_status: null,
  }
}

// For each member, attach the status of its most recent agent_runs row in this room
// (ORDER BY created_at DESC, first wins per agent). Matches the original Map logic.
function addLatestRunStatus(
  db: ReturnType<typeof getDb>,
  roomId: string,
  members: RoomAgentMemberJoinRow[],
): FormattedMember[] {
  const agentIds = members.map((member) => member.agent_id)
  if (agentIds.length === 0) return members.map(formatMember)

  const placeholders = agentIds.map(() => '?').join(',')
  const runs = db
    .prepare(
      `SELECT agent_id, status, created_at
         FROM agent_runs
        WHERE room_id = ? AND agent_id IN (${placeholders})
        ORDER BY created_at DESC`,
    )
    .all(roomId, ...agentIds) as Array<{ agent_id: string; status: string; created_at: string }>

  const latestStatusByAgent = new Map<string, string>()
  for (const run of runs) {
    if (!latestStatusByAgent.has(run.agent_id)) latestStatusByAgent.set(run.agent_id, run.status)
  }

  return members.map((member) => ({
    ...formatMember(member),
    last_run_status: latestStatusByAgent.get(member.agent_id) ?? null,
  }))
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

export async function GET(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const db = getDb()
  try {
    const rows = db
      .prepare(
        `${MEMBER_SELECT}
         WHERE m.room_id = ? AND m.member_type = 'agent'
         ORDER BY m.joined_at`,
      )
      .all(params.roomId) as RoomAgentMemberJoinRow[]

    const members = addLatestRunStatus(db, params.roomId, rows)
    return apiSuccess(members)
  } catch (e) {
    return internalError('room members list', e)
  }
}

export async function POST(req: NextRequest, props: RouteParams) {
  const params = await props.params
  const auth = await requireAuthenticatedRoomMember(req, params.roomId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parseResult = addRoomAgentSchema.safeParse(body)
  if (!parseResult.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parseResult.error.flatten())
  }

  const db = getDb()

  const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(parseResult.data.agentId) as
    | { id: string }
    | undefined

  if (!agent) return apiError('NOT_FOUND', 'Agent not found', 404)

  let insertedId: string
  try {
    insertedId = newId()
    db.prepare(
      `INSERT INTO room_members (id, room_id, agent_id, member_type, reply_enabled, muted)
       VALUES (?, ?, ?, 'agent', ?, ?)`,
    ).run(insertedId, params.roomId, parseResult.data.agentId, intBool(true), intBool(false))
  } catch (e) {
    // A duplicate (room_id, agent_id) violates room_members_agent_unique — the
    // SQLite equivalent of Postgres 23505 — meaning the agent is already in the room.
    if (
      e &&
      typeof e === 'object' &&
      'code' in e &&
      String((e as { code: unknown }).code).startsWith('SQLITE_CONSTRAINT')
    ) {
      return apiError('CONFLICT', 'Agent is already in the room', 409)
    }
    return internalError('room members add agent', e)
  }

  try {
    const row = db.prepare(`${MEMBER_SELECT} WHERE m.id = ?`).get(insertedId) as
      | RoomAgentMemberJoinRow
      | undefined

    if (!row) return internalError('room members add agent', new Error('insert returned no row'))

    const members = addLatestRunStatus(db, params.roomId, [row])
    return apiSuccess(members[0], 201)
  } catch (e) {
    return internalError('room members add agent', e)
  }
}
