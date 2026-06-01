import {
  ABS_MAX_DISCUSSION_ROUNDS,
  type Assignment,
  buildCrossReviewPairs,
  COLLAB_MAX_AGENTS,
  buildDiscussionStagePrompt,
  type CrossReviewPair,
  type DiscussCommand,
  type DiscussionPhase,
  discussionStageNumber,
  DISCUSSION_MAX_PHASES,
  formatBlackboard,
  nextDiscussionStage,
  parseTaskList,
  readDiscussionMetadata,
  selectCoordinatorIndex,
} from '@agentroom/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

// ADR-0011 — team-collaboration /discuss + adversarial /debate orchestration. Replaces the old
// individual→critique→consensus engine. After each agent run completes the worker calls
// maybeScheduleDiscussionContinuation; when ALL runs for the just-finished phase are terminal it
// schedules the next phase: plan→execute→integrate→[dissent]→converge (discuss) /
// assign→argue→rebut→adjudicate (debate). Coordinator phases (plan/assign/converge/adjudicate) run
// on one deterministic agent; the rest fan to all active agents. Peer visibility is delivered by
// the discussion-scoped context query (build-context-packet.ts), not by this scheduler.

type RunStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled'

const TERMINAL_STATUSES = new Set<RunStatus>(['completed', 'failed', 'cancelled'])

interface TriggerMessage {
  id: string
  content: string
  metadata?: Record<string, unknown>
}

interface ActiveMember {
  agent_id: string
  slug: string
  name: string
  provider: string
  capabilities: string | null
}

interface AgentMemberRow {
  agent_id: string
  agents: {
    id: string
    name: string
    slug: string
    provider: string
    capabilities: string | null
    is_active: boolean
  }
}

/** Deterministic fallback sub-tasks when the coordinator's plan can't be parsed (never stalls). */
const DISCUSS_FALLBACK_TASKS = [
  'the core approach and key design decisions',
  'the concrete implementation / steps',
  'the risks, edge cases, and how to test them',
]
const DEBATE_FALLBACK = [
  { task: 'argue FOR the strongest version of the proposal', position: 'for' as const },
  { task: 'argue AGAINST it — expose its weaknesses', position: 'against' as const },
  { task: 'argue a strong ALTERNATIVE the others are missing', position: 'alternative' as const },
]

async function loadActiveMembers(
  supabase: SupabaseClient,
  roomId: string,
): Promise<ActiveMember[]> {
  const { data } = await supabase
    .from('room_members')
    .select('agent_id, agents!inner(id, name, slug, provider, capabilities, is_active)')
    .eq('room_id', roomId)
    .eq('member_type', 'agent')
    .eq('reply_enabled', true)
    .eq('muted', false)
  return ((data ?? []) as unknown as AgentMemberRow[])
    .filter((m) => m.agents?.is_active)
    .map((m) => ({
      agent_id: m.agent_id,
      slug: m.agents.slug,
      name: m.agents.name,
      provider: m.agents.provider,
      capabilities: m.agents.capabilities,
    }))
}

function buildAttributionHeader(assignments: Assignment[]): string {
  if (assignments.length === 0) return ''
  return (
    'Attribute contributions using this ownership map:\n' +
    assignments.map((a) => `- @${a.agent_slug} owned: ${a.task}`).join('\n')
  )
}

function buildBlackboard(
  assignments: Assignment[],
  crossReviewPairs: CrossReviewPair[],
  includePairs: boolean,
): string {
  let bb = formatBlackboard(assignments)
  if (includePairs && crossReviewPairs.length > 0) {
    bb +=
      '\n\nCross-review pairs (review your assigned teammate):\n' +
      crossReviewPairs.map((p) => `- @${p.reviewer_slug} reviews @${p.reviewee_slug}`).join('\n')
  }
  return bb
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

  const command: DiscussCommand = discussion.command
  const rootId = discussion.original_message_id

  // 1. Barrier: only advance when EVERY run for the just-finished phase is terminal.
  const { data: currentRuns } = await supabase
    .from('agent_runs')
    .select('id, status')
    .eq('trigger_msg_id', triggerMessage.id)
    .eq('round_index', currentRoundIndex)
  const runs = (currentRuns ?? []) as Array<{ id: string; status: RunStatus }>
  if (runs.length === 0 || runs.some((r) => !TERMINAL_STATUSES.has(r.status))) return

  // Don't build on nothing: if the phase produced no COMPLETED run (all failed/cancelled), stop.
  if (!runs.some((r) => r.status === 'completed')) return

  // 2. Has any reply in this thread substantively challenged a peer? (anti-sycophancy gate)
  const { data: challengeRows } = await supabase
    .from('messages')
    .select('id')
    .eq('room_id', roomId)
    .eq('sender_type', 'agent')
    .contains('metadata', { discussion: { original_message_id: rootId, challenge: true } })
    .limit(1)
  const threadHasChallenge = (challengeRows ?? []).length > 0

  // 3. Next stage (DAG → self-terminates at converge/adjudicate).
  const next = nextDiscussionStage(command, discussion.phase, threadHasChallenge)
  if (!next) return

  const nextRoundIndex = currentRoundIndex + 1
  const nextStageNumber = discussionStageNumber(command, next.phase)

  // 4. Termination backstops (independent of the DAG): absolute round ceiling + phase budget.
  if (nextRoundIndex >= ABS_MAX_DISCUSSION_ROUNDS) return
  if (nextStageNumber > DISCUSSION_MAX_PHASES) return

  // 5. Idempotency pre-check (the partial unique index is the hard backstop).
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('room_id', roomId)
    .contains('metadata', {
      discussion: { enabled: true, original_message_id: rootId, phase: next.phase },
    })
    .limit(1)
  if ((existing ?? []).length > 0) return

  // 6. Who runs the next phase? Bound the tight loop to COLLAB_MAX_AGENTS (ADR-0011) so fan-out
  // stays small even in a large room — keep the discussion's coordinator, then fill by membership.
  const allActiveMembers = await loadActiveMembers(supabase, roomId)
  if (allActiveMembers.length === 0) return
  let activeMembers = allActiveMembers
  if (allActiveMembers.length > COLLAB_MAX_AGENTS) {
    const coordId = discussion.coordinator_agent_id
    const coord = allActiveMembers.find((m) => m.agent_id === coordId)
    const rest = allActiveMembers.filter((m) => m.agent_id !== coordId)
    activeMembers = (coord ? [coord, ...rest] : allActiveMembers).slice(0, COLLAB_MAX_AGENTS)
  }

  let coordinator: ActiveMember | undefined
  if (discussion.coordinator_agent_id) {
    coordinator = activeMembers.find((m) => m.agent_id === discussion.coordinator_agent_id)
  }
  if (!coordinator) {
    const idx = selectCoordinatorIndex(activeMembers)
    coordinator = idx >= 0 ? activeMembers[idx] : undefined
  }

  const targetMembers =
    next.target === 'coordinator' ? (coordinator ? [coordinator] : []) : activeMembers
  if (targetMembers.length === 0) return

  // 7. Assignments: parse fresh when leaving the plan/assign phase; otherwise carry forward.
  let assignments: Assignment[] = discussion.assignments ?? []
  let crossReviewPairs: CrossReviewPair[] = discussion.cross_review_pairs ?? []

  const leavingPlan = discussion.phase === 'plan' || discussion.phase === 'assign'
  if (leavingPlan) {
    // The coordinator's plan reply is the agent message at the just-finished round in this thread.
    const { data: planReplies } = await supabase
      .from('messages')
      .select('content, sender_agent_id')
      .eq('room_id', roomId)
      .eq('sender_type', 'agent')
      .eq('round_index', currentRoundIndex)
      .contains('metadata', { discussion: { original_message_id: rootId } })
      .order('created_at', { ascending: false })
      .limit(1)
    const planContent = (planReplies?.[0] as { content?: string } | undefined)?.content ?? ''
    assignments = parseTaskList(
      planContent,
      activeMembers.map((m) => ({ slug: m.slug, id: m.agent_id })),
    )
    if (assignments.length === 0) {
      // Deterministic fallback so execute never stalls.
      assignments = activeMembers.map((m, i) =>
        command === 'debate'
          ? {
              agent_slug: m.slug,
              agent_id: m.agent_id,
              task: DEBATE_FALLBACK[i % DEBATE_FALLBACK.length]!.task,
              position: DEBATE_FALLBACK[i % DEBATE_FALLBACK.length]!.position,
            }
          : {
              agent_slug: m.slug,
              agent_id: m.agent_id,
              task: DISCUSS_FALLBACK_TASKS[i % DISCUSS_FALLBACK_TASKS.length]!,
            },
      )
    }
    crossReviewPairs = buildCrossReviewPairs(assignments.map((a) => a.agent_slug))
  }

  // 8. Build the next-phase prompt (the trigger content for that phase's runs).
  const includePairs = next.phase === 'integrate' || next.phase === 'rebut'
  const blackboard = buildBlackboard(assignments, crossReviewPairs, includePairs)
  const isConverge = next.phase === 'converge' || next.phase === 'adjudicate'
  const content = buildDiscussionStagePrompt(command, next.phase, discussion.original_prompt, {
    blackboard,
    ...(isConverge ? { attributionHeader: buildAttributionHeader(assignments) } : {}),
  })

  // 9. Insert the next-phase system message (carrying the blackboard forward).
  // Anti-sycophancy audit: if we are converging straight out of the dissent stage and the team
  // STILL produced no substantive challenge, the answer converges but is flagged — never a silent
  // rubber-stamp (ADR-0011). debate self-satisfies the gate, so this only applies to discuss.
  const antiSycophancy =
    isConverge && discussion.phase === 'dissent' && !threadHasChallenge
      ? { anti_sycophancy: 'no_challenge_after_dissent' }
      : {}

  const nextMetadata = {
    discussion: {
      enabled: true,
      command,
      phase: next.phase,
      original_message_id: rootId,
      original_prompt: discussion.original_prompt,
      ...(coordinator ? { coordinator_agent_id: coordinator.agent_id } : {}),
      assignments,
      cross_review_pairs: crossReviewPairs,
      ...antiSycophancy,
    },
  }

  const { data: nextMessage, error: nextMessageError } = await supabase
    .from('messages')
    .insert({
      room_id: roomId,
      sender_type: 'system',
      content,
      content_type: 'text',
      mentions: [],
      target_agent_ids: targetMembers.map((m) => m.agent_id),
      round_index: nextRoundIndex,
      metadata: nextMetadata,
    })
    .select('id')
    .single()

  if (nextMessageError) {
    if (nextMessageError.code === '23505') return // lost the idempotency race — fine
    throw nextMessageError
  }
  if (!nextMessage) return

  // 10. Schedule the next-phase runs. deliberation_depth is carried forward as the phase number
  // (NOT reset to 0 — the old bug), so a hand-off spawned inside a late discussion phase starts
  // with elevated depth and hits max_agent_hops sooner. deliberation_root_id stays null: that FK
  // references agent_runs(id), not a message, and a handoff self-roots at its own run id, so
  // cycle detection within any handoff subtree still works. (ADR-0011 proposed root=message id,
  // which the agent_runs_deliberation_root_id_fkey makes infeasible; the intent is preserved.)
  const { error: runsError } = await supabase.from('agent_runs').insert(
    targetMembers.map((m) => ({
      room_id: roomId,
      agent_id: m.agent_id,
      trigger_msg_id: nextMessage.id,
      status: 'queued',
      round_index: nextRoundIndex,
      discussion_mode: 'tag_turns',
      deliberation_depth: nextStageNumber,
      deliberation_root_id: null,
    })),
  )
  if (runsError) throw runsError
}
