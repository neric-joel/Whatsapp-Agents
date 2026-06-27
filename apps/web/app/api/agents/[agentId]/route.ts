import { getDb, intBool, jsonText, rowToAgent } from '@agentroom/db'
import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { updateAgentSchema } from '@/lib/api-validation'
import { getAuthenticatedUser } from '@/lib/auth'

interface RouteParams {
  params: { agentId: string }
}

/**
 * Loads the agent and asserts the caller created it. Seeded agents
 * (`created_by_user_id IS NULL`) and other users' agents are never editable —
 * this is the ownership gate for edit/disable. Also rate-limits per user (each
 * call does a DB read), mirroring the memory sub-resource route.
 */
async function requireAgentCreator(req: NextRequest, agentId: string) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return { error: apiError('UNAUTHORIZED', 'Unauthorized', 401) }

  const limited = enforceRateLimit(`agent-mutate:${user.id}`, 60, 60_000)
  if (limited) return { error: limited }

  const db = getDb()
  const agent = db
    .prepare('SELECT id, created_by_user_id FROM agents WHERE id = ?')
    .get(agentId) as { id: string; created_by_user_id: string | null } | undefined

  if (!agent) return { error: apiError('NOT_FOUND', 'Agent not found', 404) }
  if (agent.created_by_user_id !== user.id) {
    return { error: apiError('FORBIDDEN', 'Only the creator can modify this agent', 403) }
  }
  return { db, userId: user.id }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const auth = await requireAgentCreator(req, params.agentId)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => null)
  const parsed = updateAgentSchema.safeParse(body)
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid request body', 400, parsed.error.flatten())
  }

  // Build a dynamic SET clause from only the provided fields. Booleans go through
  // intBool; json columns (tool_permissions, if ever provided) through jsonText.
  const fields = parsed.data as Record<string, unknown>
  const cols: string[] = []
  const vals: unknown[] = []
  for (const [key, value] of Object.entries(fields)) {
    cols.push(`${key} = ?`)
    if (key === 'is_active') {
      vals.push(intBool(value as boolean))
    } else if (key === 'tool_permissions') {
      vals.push(jsonText(value))
    } else {
      vals.push(value)
    }
  }

  try {
    const row = auth.db
      .prepare(`UPDATE agents SET ${cols.join(', ')} WHERE id = ? RETURNING *`)
      .get(...vals, params.agentId)
    if (!row) return internalError('agent update', new Error('Agent not found'))
    return apiSuccess(rowToAgent(row as Record<string, unknown>))
  } catch (e) {
    return internalError('agent update', e)
  }
}

/**
 * Disable (not hard-delete) the agent: sets `is_active = false`, which removes it
 * from rosters and run targeting while leaving its history intact. Reversible via
 * PATCH `{ is_active: true }`.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const csrf = assertSameOrigin(req)
  if (csrf) return csrf

  const auth = await requireAgentCreator(req, params.agentId)
  if ('error' in auth) return auth.error

  try {
    auth.db
      .prepare('UPDATE agents SET is_active = ? WHERE id = ?')
      .run(intBool(false), params.agentId)
  } catch (e) {
    return internalError('agent disable', e)
  }
  return apiSuccess({ id: params.agentId, is_active: false })
}
