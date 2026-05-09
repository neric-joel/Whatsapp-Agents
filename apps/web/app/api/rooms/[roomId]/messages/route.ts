import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { parseMentions } from '@/lib/mention-parser'

interface RouteParams { params: { roomId: string } }

type AgentMemberRow = {
  agent_id: string
  agents: { id: string; slug: string; name: string; is_active: boolean }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { roomId } = params

  // 1. Authenticate
  const supabaseUser = createSupabaseServerClient()
  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser()
  if (authErr || !user) return err('Unauthorized', 401)

  // 2. Verify room membership
  const supabase = createSupabaseServiceClient()
  const { data: member } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', roomId)
    .eq('user_id', user.id)
    .eq('member_type', 'user')
    .single()

  if (!member) return err('Forbidden', 403)

  // 3. Parse body
  const body = await req.json().catch(() => null)
  if (!body || typeof body.content !== 'string' || !body.content.trim()) {
    return err('content is required')
  }

  const roundIndex: number = typeof body.round_index === 'number' ? body.round_index : 0
  const hopIndex: number = typeof body.hop_index === 'number' ? body.hop_index : 0

  // 4. Fetch room for reply_mode and loop guard limits
  const { data: room } = await supabase
    .from('rooms')
    .select('id, reply_mode, max_agent_rounds, max_agent_hops, allow_agent_to_agent')
    .eq('id', roomId)
    .single()

  if (!room) return err('Room not found', 404)

  // 5. Insert message
  const { data: message, error: msgErr } = await supabase
    .from('messages')
    .insert({
      room_id: roomId,
      sender_type: 'user',
      sender_user_id: user.id,
      content: body.content.trim(),
      content_type: body.content_type ?? 'text',
      reply_to_id: body.reply_to_id ?? null,
      mentions: body.mentions ?? [],
      target_agent_ids: body.target_agent_ids ?? [],
      round_index: roundIndex,
      metadata: body.metadata ?? {},
    })
    .select()
    .single()

  if (msgErr || !message) return err(msgErr?.message ?? 'Failed to insert message', 500)

  // 6. Update room.last_message_at
  await supabase
    .from('rooms')
    .update({ last_message_at: message.created_at })
    .eq('id', roomId)

  const insertSystemMessage = (content: string) =>
    supabase.from('messages').insert({
      room_id: roomId,
      sender_type: 'system',
      content,
      content_type: 'text',
      mentions: [],
      target_agent_ids: [],
      round_index: roundIndex,
    })

  // 7. Loop guard
  const maxRounds = (room as { max_agent_rounds: number }).max_agent_rounds
  const maxHops = (room as { max_agent_hops: number }).max_agent_hops

  if (roundIndex >= maxRounds) {
    await insertSystemMessage(`Loop guard: agent discussion stopped after ${maxRounds} rounds.`)
    return ok({ message, agent_runs: [] }, 201)
  }

  if (hopIndex >= maxHops) {
    await insertSystemMessage(`Loop guard: agent chain stopped after ${maxHops} hops.`)
    return ok({ message, agent_runs: [] }, 201)
  }

  // 8. Find active, unmuted agents with reply_enabled=true
  const { data: rawMembers } = await supabase
    .from('room_members')
    .select('agent_id, agents!inner(id, slug, name, is_active)')
    .eq('room_id', roomId)
    .eq('member_type', 'agent')
    .eq('reply_enabled', true)
    .eq('muted', false)

  const allActive = ((rawMembers ?? []) as unknown as AgentMemberRow[]).filter(
    (m) => m.agents?.is_active
  )

  // 9. Mention-based routing
  const content = body.content.trim()
  const mentions = parseMentions(content, allActive.map((m) => m.agents))
  const replyMode = (room as { reply_mode: string }).reply_mode

  let targetAgents = allActive

  if (replyMode === 'mentioned_only') {
    if (mentions.length === 0) {
      await insertSystemMessage('No agents were mentioned. Use @agent_slug or @everyone.')
      return ok({ message, agent_runs: [] }, 201)
    }
    const hasEveryone = mentions.some((m) => m.type === 'everyone')
    if (!hasEveryone) {
      const ids = new Set(mentions.filter((m) => m.type === 'agent').map((m) => m.agent_id))
      targetAgents = allActive.filter((m) => ids.has(m.agent_id))
    }
  }
  // 'everyone' / 'smart' / other → all active agents (no change)

  // 10. Create one agent_run per qualifying agent
  const agentRuns: unknown[] = []
  if (targetAgents.length > 0) {
    const runs = targetAgents.map((m) => ({
      room_id: roomId,
      agent_id: m.agent_id,
      trigger_msg_id: message.id,
      status: 'queued',
      round_index: roundIndex,
    }))

    const { data: insertedRuns } = await supabase
      .from('agent_runs')
      .insert(runs)
      .select()

    if (insertedRuns) agentRuns.push(...insertedRuns)
  }

  return ok({ message, agent_runs: agentRuns }, 201)
}
