import { NextRequest } from 'next/server'

import { apiError, apiSuccess } from '@/lib/api-error'
import { assertSameOrigin, enforceRateLimit, internalError } from '@/lib/api-security'
import { createAgentSchema } from '@/lib/api-validation'
import { requireRoomAdmin } from '@/lib/permissions'
import { createSupabaseServiceClient, getAuthenticatedUser } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const {
    data: { user },
    error: authErr,
  } = await getAuthenticatedUser(req)
  if (authErr || !user) return apiError('UNAUTHORIZED', 'Unauthorized', 401)

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('agents')
    .select('id, name, slug, provider, adapter_type, is_active')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) return internalError('agents list', error)

  return apiSuccess(data ?? [])
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

  const supabase = createSupabaseServiceClient()
  try {
    await requireRoomAdmin(supabase, input.room_id, user.id)
  } catch (e) {
    return e as Response
  }

  // Reject a slug that already names an active agent in this room — mention +
  // hand-off resolution is by slug within the room, so duplicates are ambiguous.
  const { data: clash } = await supabase
    .from('room_members')
    .select('agent_id, agents!inner(slug, is_active)')
    .eq('room_id', input.room_id)
    .eq('member_type', 'agent')
  const slugTaken = (
    (clash ?? []) as unknown as Array<{ agents: { slug: string; is_active: boolean } | null }>
  ).some((m) => m.agents?.is_active && m.agents.slug === input.slug)
  if (slugTaken) {
    return apiError('CONFLICT', 'An agent with that slug is already in this room', 409)
  }

  // BYO credential (ADR-0010): if the agent binds a credential, it MUST be the caller's
  // own — verify ownership before linking (the secret never touches the agent row).
  if (input.credential_id) {
    const { data: cred } = await supabase
      .from('user_credentials')
      .select('id')
      .eq('id', input.credential_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!cred) {
      return apiError('VALIDATION_ERROR', 'credential_id not found or not owned by you', 400)
    }
  }

  const { data: agent, error: agentErr } = await supabase
    .from('agents')
    .insert({
      name: input.name,
      slug: input.slug,
      avatar_url: input.avatar_url ?? null,
      provider: input.provider,
      adapter_type: input.adapter_type ?? 'subprocess',
      model: input.model ?? null,
      system_prompt: input.system_prompt ?? null,
      capabilities: input.capabilities ?? null,
      reply_policy: input.reply_policy ?? 'reply_when_invoked',
      tool_permissions: {},
      credential_id: input.credential_id ?? null,
      created_by_user_id: user.id,
      is_active: true,
    })
    .select('id, name, slug, provider, adapter_type, capabilities, is_active')
    .single()

  if (agentErr || !agent) {
    if (agentErr?.code === '23505') {
      return apiError('CONFLICT', 'You already have an agent with that slug', 409)
    }
    return internalError('agent create', agentErr)
  }

  const { error: memberErr } = await supabase.from('room_members').insert({
    room_id: input.room_id,
    agent_id: agent.id,
    member_type: 'agent',
    reply_enabled: true,
    muted: false,
  })
  // A duplicate member (23505) is harmless. Any other attach failure would leave
  // an orphan agent (owned, attached to no room, polluting the slug namespace):
  // disable it before returning so create+attach is effectively all-or-nothing.
  if (memberErr && memberErr.code !== '23505') {
    await supabase.from('agents').update({ is_active: false }).eq('id', agent.id)
    return internalError('agent create room attach', memberErr)
  }

  return apiSuccess(agent, 201)
}
