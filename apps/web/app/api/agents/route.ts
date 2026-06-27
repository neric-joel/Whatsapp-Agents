import { getDb, getProfile, intBool, jsonText, newId, rowToAgent } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createAgentSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'
import { requireRoomAdmin } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const db = getDb()
  try {
    const rows = db
      .prepare('SELECT * FROM agents WHERE is_active = 1 ORDER BY name ASC')
      .all() as Record<string, unknown>[]
    return apiSuccess(rows.map(rowToAgent))
  } catch (e) {
    return internalError('agents list', e)
  }
}

/**
 * Phase 11 — create a user-defined agent. RBAC: the caller must be an admin or
 * owner of the target room (server-side, not UI-only). The agent is owned by the
 * creator (`created_by_user_id`) and added to that room as a member in one step.
 *
 * Security: `system_prompt` is persisted as data and only ever reaches a CLI via
 * stdin (never argv) — see subprocess-security. `tool_permissions` is forced to
 * empty: a user-created agent gets no tool auto-approvals; every tool still flows
 * through the approval gate.
 */
export async function POST(req: NextRequest) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const limited = enforceRateLimit(`agent-create:${user.id}`, 20, 60_000)
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = createAgentSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }
  const input = parsed.data

  // adapter_type 'cli' (a connected CLI): the profile id is stored in `provider` so
  // the bridge's CliProfileAdapter can resolve it. Validate the profile exists.
  let providerToStore: string = input.provider
  if (input.adapter_type === 'cli') {
    if (!input.cli_profile_id) {
      return apiError('VALIDATION_ERROR', 'cli_profile_id is required for a CLI agent', 400)
    }
    if (!getProfile(input.cli_profile_id)) {
      return apiError('VALIDATION_ERROR', 'cli_profile_id does not match a connected CLI', 400)
    }
    providerToStore = input.cli_profile_id
  }

  const db = getDb()
  try {
    await requireRoomAdmin(input.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  // Reject a slug that already names an active agent in this room — mention +
  // hand-off resolution is by slug within the room, so duplicates are ambiguous.
  try {
    const clash = db
      .prepare(
        `SELECT a.slug AS slug, a.is_active AS is_active
         FROM room_members m
         INNER JOIN agents a ON a.id = m.agent_id
         WHERE m.room_id = ? AND m.member_type = 'agent'`,
      )
      .all(input.room_id) as Array<{ slug: string; is_active: number }>
    const slugTaken = clash.some((m) => m.is_active === 1 && m.slug === input.slug)
    if (slugTaken) {
      return apiError('CONFLICT', 'An agent with that slug is already in this room', 409)
    }
  } catch (e) {
    return internalError('agent slug check', e)
  }

  // BYO credential (ADR-0010): if the agent binds a credential, it MUST be the caller's
  // own — verify ownership before linking (the secret never touches the agent row).
  if (input.credential_id) {
    let cred: { id: string } | undefined
    try {
      cred = db
        .prepare('SELECT id FROM user_credentials WHERE id = ? AND user_id = ?')
        .get(input.credential_id, user.id) as { id: string } | undefined
    } catch (e) {
      return internalError('credential lookup', e)
    }
    if (!cred) {
      return apiError('VALIDATION_ERROR', 'credential_id not found or not owned by you', 400)
    }
  }

  let agent: ReturnType<typeof rowToAgent>
  try {
    const row = db
      .prepare(
        `INSERT INTO agents (
           id, name, slug, avatar_url, provider, adapter_type, model,
           system_prompt, capabilities, reply_policy, tool_permissions,
           credential_id, created_by_user_id, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(
        newId(),
        input.name,
        input.slug,
        input.avatar_url ?? null,
        providerToStore,
        input.adapter_type ?? 'subprocess',
        input.model ?? null,
        input.system_prompt ?? null,
        input.capabilities ?? null,
        input.reply_policy ?? 'reply_when_invoked',
        jsonText({}),
        input.credential_id ?? null,
        user.id,
        intBool(true),
      ) as Record<string, unknown> | undefined
    if (!row) return internalError('agent create', new Error('insert returned no row'))
    agent = rowToAgent(row)
  } catch (e) {
    // SQLite UNIQUE on (created_by_user_id, slug) — the Postgres 23505 path.
    const msg = e instanceof Error ? e.message : String(e)
    if (/UNIQUE constraint failed/i.test(msg)) {
      return apiError('CONFLICT', 'You already have an agent with that slug', 409)
    }
    return internalError('agent create', e)
  }

  try {
    db.prepare(
      `INSERT INTO room_members (
         id, room_id, agent_id, member_type, reply_enabled, muted
       ) VALUES (?, ?, ?, 'agent', ?, ?)`,
    ).run(newId(), input.room_id, agent.id, intBool(true), intBool(false))
  } catch (e) {
    // A duplicate member (UNIQUE) is harmless. Any other attach failure would leave
    // an orphan agent (owned, attached to no room, polluting the slug namespace):
    // disable it before returning so create+attach is effectively all-or-nothing.
    const msg = e instanceof Error ? e.message : String(e)
    if (!/UNIQUE constraint failed/i.test(msg)) {
      try {
        db.prepare('UPDATE agents SET is_active = 0 WHERE id = ?').run(agent.id)
      } catch {
        // best-effort cleanup
      }
      return internalError('agent create room attach', e)
    }
  }

  return apiSuccess(agent, 201)
}
