import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { updateAgentSchema } from '@/lib/api-validation'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

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

  const supabase = createSupabaseServiceClient()
  const { data: agent } = await supabase
    .from('agents')
    .select('id, created_by_user_id')
    .eq('id', agentId)
    .maybeSingle()

  if (!agent) return { error: apiError('NOT_FOUND', 'Agent not found', 404) }
  if (agent.created_by_user_id !== user.id) {
    return { error: apiError('FORBIDDEN', 'Only the creator can modify this agent', 403) }
  }
  return { supabase }
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

  const { data, error } = await auth.supabase
    .from('agents')
    .update(parsed.data)
    .eq('id', params.agentId)
    .select('id, name, slug, provider, adapter_type, capabilities, is_active')
    .single()

  if (error || !data) return internalError('agent update', error)
  return apiSuccess(data)
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

  const { error } = await auth.supabase
    .from('agents')
    .update({ is_active: false })
    .eq('id', params.agentId)

  if (error) return internalError('agent disable', error)
  return apiSuccess({ id: params.agentId, is_active: false })
}
