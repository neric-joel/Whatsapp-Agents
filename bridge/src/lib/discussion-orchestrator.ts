import type { SupabaseClient } from '@supabase/supabase-js'

type DiscussionPhase = 'individual' | 'critique' | 'consensus'

type RunStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'

interface TriggerMessage {
  id: string
  content: string
  metadata?: Record<string, unknown>
}

interface AgentMemberRow {
  agent_id: string
  agents: {
    id: string
    name: string
    slug: string
    provider: string
    is_active: boolean
  }
}

interface DiscussionMetadata {
  enabled: boolean
  phase: DiscussionPhase
  original_message_id: string
  original_prompt: string
}

const TERMINAL_STATUSES = new Set<RunStatus>(['completed', 'failed', 'cancelled'])

export function nextDiscussionPhase(phase: DiscussionPhase): DiscussionPhase | null {
  if (phase === 'individual') return 'critique'
  if (phase === 'critique') return 'consensus'
  return null
}

export function buildDiscussionPhasePrompt(phase: DiscussionPhase, originalPrompt: string): string {
  if (phase === 'critique') {
    return [
      'Discussion phase 2: critique and synthesis.',
      '',
      'Original problem:',
      originalPrompt,
      '',
      'Read the independent agent answers above. Identify mistakes, missing edge cases, and over/under-abstraction. Engage directly with the other agents by name when useful. Do not just solve alone; compare approaches and move the group toward a stronger answer.',
    ].join('\n')
  }

  return [
    'Discussion phase 3: consensus and conclusion.',
    '',
    'Original problem:',
    originalPrompt,
    '',
    'Use the prior independent answers and critique round to produce one clear final consensus response for the room. State the final answer, explain the reasoning compactly, and mention any caveats the team agreed matter.',
  ].join('\n')
}

export function readDiscussionMetadata(metadata: Record<string, unknown> | undefined): DiscussionMetadata | null {
  const discussion = metadata?.discussion
  if (!discussion || typeof discussion !== 'object' || Array.isArray(discussion)) return null

  const value = discussion as Record<string, unknown>
  if (value.enabled !== true) return null
  if (value.phase !== 'individual' && value.phase !== 'critique' && value.phase !== 'consensus') return null
  if (typeof value.original_message_id !== 'string') return null
  if (typeof value.original_prompt !== 'string' || value.original_prompt.trim().length === 0) return null

  return {
    enabled: true,
    phase: value.phase,
    original_message_id: value.original_message_id,
    original_prompt: value.original_prompt,
  }
}

export function selectConsensusAgent(members: AgentMemberRow[]): AgentMemberRow | null {
  return members.find((member) => member.agents.slug.includes('codex') || member.agents.provider === 'codex_cli')
    ?? members[0]
    ?? null
}

export async function maybeScheduleDiscussionContinuation({
  supabase,
  roomId,
  currentRoundIndex,
  triggerMessage,
}: {
  supabase: SupabaseClient
  roomId: string
  currentRoundIndex: number
  triggerMessage: TriggerMessage
}): Promise<void> {
  const discussion = readDiscussionMetadata(triggerMessage.metadata)
  if (!discussion) return

  const nextPhase = nextDiscussionPhase(discussion.phase)
  if (!nextPhase) return

  const { data: room } = await supabase
    .from('rooms')
    .select('max_agent_rounds')
    .eq('id', roomId)
    .single()

  const nextRoundIndex = currentRoundIndex + 1
  if (room && nextRoundIndex >= (room as { max_agent_rounds: number }).max_agent_rounds) return

  const { data: currentRuns } = await supabase
    .from('agent_runs')
    .select('id, status')
    .eq('trigger_msg_id', triggerMessage.id)
    .eq('round_index', currentRoundIndex)

  const runs = (currentRuns ?? []) as Array<{ id: string; status: RunStatus }>
  if (runs.length === 0 || runs.some((run) => !TERMINAL_STATUSES.has(run.status))) return

  const { data: existingPhaseMessage } = await supabase
    .from('messages')
    .select('id')
    .eq('room_id', roomId)
    .contains('metadata', {
      discussion: {
        enabled: true,
        original_message_id: discussion.original_message_id,
        phase: nextPhase,
      },
    })
    .limit(1)

  if ((existingPhaseMessage ?? []).length > 0) return

  const { data: rawMembers } = await supabase
    .from('room_members')
    .select('agent_id, agents!inner(id, name, slug, provider, is_active)')
    .eq('room_id', roomId)
    .eq('member_type', 'agent')
    .eq('reply_enabled', true)
    .eq('muted', false)

  const activeMembers = ((rawMembers ?? []) as unknown as AgentMemberRow[])
    .filter((member) => member.agents?.is_active)

  const targetMembers = nextPhase === 'consensus'
    ? [selectConsensusAgent(activeMembers)].filter((member): member is AgentMemberRow => Boolean(member))
    : activeMembers

  if (targetMembers.length === 0) return

  const metadata = {
    discussion: {
      enabled: true,
      phase: nextPhase,
      original_message_id: discussion.original_message_id,
      original_prompt: discussion.original_prompt,
    },
  }

  const { data: nextMessage, error: nextMessageError } = await supabase.from('messages').insert({
    room_id: roomId,
    sender_type: 'system',
    content: buildDiscussionPhasePrompt(nextPhase, discussion.original_prompt),
    content_type: 'text',
    mentions: [],
    target_agent_ids: targetMembers.map((member) => member.agent_id),
    round_index: nextRoundIndex,
    metadata,
  }).select('id').single()

  if (nextMessageError) {
    if (nextMessageError.code === '23505') return
    throw nextMessageError
  }

  if (!nextMessage) return

  await supabase.from('agent_runs').insert(targetMembers.map((member) => ({
    room_id: roomId,
    agent_id: member.agent_id,
    trigger_msg_id: nextMessage.id,
    status: 'queued',
    round_index: nextRoundIndex,
  })))
}
