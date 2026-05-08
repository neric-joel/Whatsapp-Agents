import { NextRequest } from 'next/server'
import { ok, err } from '@/lib/api'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface RouteParams { params: { roomId: string } }

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

  // 4. Insert message
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
      round_index: 0,
    })
    .select()
    .single()

  if (msgErr || !message) return err(msgErr?.message ?? 'Failed to insert message', 500)

  // 5. Update room.last_message_at
  await supabase
    .from('rooms')
    .update({ last_message_at: message.created_at })
    .eq('id', roomId)

  // 6. Find active, unmuted agents with reply_enabled=true
  const { data: agentMembers } = await supabase
    .from('room_members')
    .select('agent_id, agents!inner(id, is_active)')
    .eq('room_id', roomId)
    .eq('member_type', 'agent')
    .eq('reply_enabled', true)
    .eq('muted', false)

  // 7. Create one agent_run per qualifying agent
  const agentRuns: unknown[] = []
  if (agentMembers && agentMembers.length > 0) {
    const runs = agentMembers
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((m: any) => m.agents?.is_active)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((m: any) => ({
        room_id: roomId,
        agent_id: m.agent_id,
        trigger_msg_id: message.id,
        status: 'queued',
        round_index: 0,
      }))

    if (runs.length > 0) {
      const { data: insertedRuns } = await supabase
        .from('agent_runs')
        .insert(runs)
        .select()

      if (insertedRuns) agentRuns.push(...insertedRuns)
    }
  }

  return ok({ message, agent_runs: agentRuns }, 201)
}
