import { getDb, jsonText, newId } from '@agentroom/db'
import {
  ABS_MAX_DISCUSSION_ROUNDS,
  type Assignment,
  buildCrossReviewPairs,
  buildDiscussionStagePrompt,
  COLLAB_MAX_AGENTS,
  type CrossReviewPair,
  type DiscussCommand,
  DISCUSSION_MAX_PHASES,
  discussionStageNumber,
  formatBlackboard,
  nextDiscussionStage,
  parseTaskList,
  readDiscussionMetadata,
  selectCoordinatorIndex,
} from '@agentroom/shared'

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

function loadActiveMembers(roomId: string): ActiveMember[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT rm.agent_id AS agent_id,
              a.id AS id, a.name AS name, a.slug AS slug,
              a.provider AS provider, a.capabilities AS capabilities, a.is_active AS is_active
         FROM room_members rm
         JOIN agents a ON a.id = rm.agent_id
        WHERE rm.room_id = ?
          AND rm.member_type = 'agent'
          AND rm.reply_enabled = 1
          AND rm.muted = 0`,
    )
    .all(roomId) as Array<{
    agent_id: string
    id: string
    name: string
    slug: string
    provider: string
    capabilities: string | null
    is_active: number
  }>
  return rows
    .map(
      (r): AgentMemberRow => ({
        agent_id: r.agent_id,
        agents: {
          id: r.id,
          name: r.name,
          slug: r.slug,
          provider: r.provider,
          capabilities: r.capabilities,
          is_active: r.is_active === 1,
        },
      }),
    )
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
  roomId,
  currentRoundIndex,
  triggerMessage,
}: {
  roomId: string
  currentRoundIndex: number
  triggerMessage: TriggerMessage
}): Promise<void> {
  const db = getDb()
  const discussion = readDiscussionMetadata(triggerMessage.metadata)
  if (!discussion) return

  const command: DiscussCommand = discussion.command
  const rootId = discussion.original_message_id

  // 1. Barrier: only advance when EVERY run for the just-finished phase is terminal.
  const currentRuns = db
    .prepare(`SELECT id, status FROM agent_runs WHERE trigger_msg_id = ? AND round_index = ?`)
    .all(triggerMessage.id, currentRoundIndex)
  const runs = (currentRuns ?? []) as Array<{ id: string; status: RunStatus }>
  if (runs.length === 0 || runs.some((r) => !TERMINAL_STATUSES.has(r.status))) return

  // Don't build on nothing: if the phase produced no COMPLETED run (all failed/cancelled), stop.
  if (!runs.some((r) => r.status === 'completed')) return

  // 2. Has any reply in this thread substantively challenged a peer? (anti-sycophancy gate)
  const challengeRows = db
    .prepare(
      `SELECT id FROM messages
        WHERE room_id = ?
          AND sender_type = 'agent'
          AND json_extract(metadata, '$.discussion.original_message_id') = ?
          AND json_extract(metadata, '$.discussion.challenge') = 1
        LIMIT 1`,
    )
    .all(roomId, rootId)
  const threadHasChallenge = (challengeRows ?? []).length > 0

  // 3. Next stage (DAG → self-terminates at converge/adjudicate).
  const next = nextDiscussionStage(command, discussion.phase, threadHasChallenge)
  if (!next) return

  const nextRoundIndex = currentRoundIndex + 1
  const nextStageNumber = discussionStageNumber(command, next.phase)

  // 4. Termination backstops (independent of the DAG): absolute round ceiling + phase budget.
  if (nextRoundIndex >= ABS_MAX_DISCUSSION_ROUNDS) return
  if (nextStageNumber > DISCUSSION_MAX_PHASES) return

  // 5. Idempotency pre-check. The single local bridge runs better-sqlite3 synchronously, so this
  //    SELECT-then-INSERT executes atomically within one run's turn — it is the sole guard against
  //    a duplicate next-phase fan-out (there is no multi-worker topology in the local app).
  const existing = db
    .prepare(
      `SELECT id FROM messages
        WHERE room_id = ?
          AND json_extract(metadata, '$.discussion.enabled') = 1
          AND json_extract(metadata, '$.discussion.original_message_id') = ?
          AND json_extract(metadata, '$.discussion.phase') = ?
        LIMIT 1`,
    )
    .all(roomId, rootId, next.phase)
  if ((existing ?? []).length > 0) return

  // 6. Who runs the next phase? Bound the tight loop to COLLAB_MAX_AGENTS (ADR-0011) so fan-out
  // stays small even in a large room — keep the discussion's coordinator, then fill by membership.
  const allActiveMembers = loadActiveMembers(roomId)
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
    const planReplies = db
      .prepare(
        `SELECT content, sender_agent_id FROM messages
          WHERE room_id = ?
            AND sender_type = 'agent'
            AND round_index = ?
            AND json_extract(metadata, '$.discussion.original_message_id') = ?
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .all(roomId, currentRoundIndex, rootId)
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

  let nextMessage: { id: string } | undefined
  try {
    nextMessage = db
      .prepare(
        `INSERT INTO messages
           (id, room_id, sender_type, content, content_type, mentions, target_agent_ids, round_index, metadata)
         VALUES (?, ?, 'system', ?, 'text', ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        newId(),
        roomId,
        content,
        jsonText([]),
        jsonText(targetMembers.map((m) => m.agent_id)),
        nextRoundIndex,
        jsonText(nextMetadata),
      ) as { id: string } | undefined
  } catch (nextMessageError) {
    // Belt-and-suspenders: only fires if a UNIQUE index is ever added on the discussion key.
    if ((nextMessageError as { code?: string })?.code === 'SQLITE_CONSTRAINT_UNIQUE') return
    throw nextMessageError
  }
  if (!nextMessage) return

  // 10. Schedule the next-phase runs. deliberation_depth is carried forward as the phase number
  // (NOT reset to 0 — the old bug), so a hand-off spawned inside a late discussion phase starts
  // with elevated depth and hits max_agent_hops sooner. deliberation_root_id stays null: that FK
  // references agent_runs(id), not a message, and a handoff self-roots at its own run id, so
  // cycle detection within any handoff subtree still works. (ADR-0011 proposed root=message id,
  // which the agent_runs_deliberation_root_id_fkey makes infeasible; the intent is preserved.)
  const insertRun = db.prepare(
    `INSERT INTO agent_runs
       (id, room_id, agent_id, trigger_msg_id, status, round_index, discussion_mode, deliberation_depth, deliberation_root_id)
     VALUES (?, ?, ?, ?, 'queued', ?, 'tag_turns', ?, ?)`,
  )
  for (const m of targetMembers) {
    insertRun.run(
      newId(),
      roomId,
      m.agent_id,
      nextMessage.id,
      nextRoundIndex,
      nextStageNumber,
      null,
    )
  }
}
