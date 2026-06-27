import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { maybeScheduleDiscussionContinuation } from '../src/lib/discussion-orchestrator.js'
import {
  freshTestDb,
  seedAgent,
  seedMember,
  seedMessage,
  seedRoom,
  seedRun,
  type TestDb,
} from './helpers/test-db.js'

// ── Real local-SQLite migration of the orchestrator phase-machine tests ──
// The orchestrator now reads everything via getDb() (no supabase param). Each test seeds:
//   - a room + the active agent members it fans out to,
//   - the agent_runs for the just-finished phase (the barrier reads these by
//     trigger_msg_id + round_index),
//   - (where the phase leaves plan/assign) the coordinator's plan reply message,
//   - (challenge / idempotency cases) the relevant discussion messages,
// then asserts on the actual rows the function INSERTS: the next-phase system message
// (carrying metadata.discussion forward) and the queued agent_runs for that phase.

const ROOM = 'room'
const ROOT = 'root'

// Coordinator is 'a' (matches discMeta.coordinator_agent_id below).
const MEMBERS = [
  { id: 'a', slug: 'alpha' },
  { id: 'b', slug: 'bravo' },
  { id: 'c', slug: 'charlie' },
]

let h: TestDb

beforeEach(() => {
  h = freshTestDb()
})
afterEach(() => h.cleanup())

/** Seed the room + the given agents as active, reply-enabled, unmuted members. */
function seedRoomWithMembers(members: Array<{ id: string; slug: string }>) {
  seedRoom(h.db, { id: ROOM, name: 'Test Room' })
  for (const m of members) {
    seedAgent(h.db, { id: m.id, slug: m.slug, name: m.slug, provider: 'mock', is_active: 1 })
    seedMember(h.db, ROOM, {
      agent_id: m.id,
      member_type: 'agent',
      reply_enabled: 1,
      muted: 0,
    })
  }
}

/** Seed N agent_runs for the just-finished phase (the barrier query keys on these). */
function seedPhaseRuns(triggerMsgId: string, roundIndex: number, statuses: string[]) {
  for (const status of statuses) {
    seedRun(h.db, ROOM, 'a', { trigger_msg_id: triggerMsgId, round_index: roundIndex, status })
  }
}

/** Seed the coordinator's plan reply (an agent message at the just-finished round in this thread). */
function seedPlanReply(content: string, roundIndex: number) {
  seedMessage(h.db, ROOM, {
    sender_type: 'agent',
    sender_agent_id: 'a',
    content,
    round_index: roundIndex,
    metadata: JSON.stringify({
      discussion: { enabled: true, command: 'discuss', phase: 'plan', original_message_id: ROOT },
    }),
  })
}

const discMeta = (
  phase: string,
  command: 'discuss' | 'debate' = 'discuss',
  extra: Record<string, unknown> = {},
) => ({
  discussion: {
    enabled: true,
    command,
    phase,
    original_message_id: ROOT,
    original_prompt: 'Design a thing',
    coordinator_agent_id: 'a',
    ...extra,
  },
})

/** All next-phase messages the function inserted (it inserts them as sender_type='system'). */
function insertedMessages(): Array<{ id: string; round_index: number; metadata: any }> {
  return (
    h.db
      .prepare(`SELECT id, round_index, metadata FROM messages WHERE sender_type = 'system'`)
      .all() as Array<{ id: string; round_index: number; metadata: string }>
  ).map((r) => ({ id: r.id, round_index: r.round_index, metadata: JSON.parse(r.metadata) }))
}

/** All agent_runs the function queued for the next phase (it inserts them with status='queued'). */
function insertedRuns(): Array<{
  agent_id: string
  round_index: number
  deliberation_depth: number
  deliberation_root_id: string | null
}> {
  return h.db
    .prepare(
      `SELECT agent_id, round_index, deliberation_depth, deliberation_root_id
         FROM agent_runs WHERE status = 'queued'`,
    )
    .all() as Array<{
    agent_id: string
    round_index: number
    deliberation_depth: number
    deliberation_root_id: string | null
  }>
}

test('plan→execute: parses the plan reply into assignments and fans to all agents', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('plan-msg', 0, ['completed'])
  seedPlanReply('@alpha: design API\n@bravo: implement\n@charlie: tests', 0)

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan-msg', content: '', metadata: discMeta('plan') },
  })

  const msgs = insertedMessages()
  assert.equal(msgs.length, 1)
  const msg = msgs[0]!
  assert.equal(msg.metadata.discussion.phase, 'execute')
  assert.equal(msg.metadata.discussion.assignments.length, 3)

  const runs = insertedRuns()
  assert.equal(runs.length, 3) // all active agents execute
  // deliberation_depth carried forward as the phase number (NOT reset to 0); root stays null
  // (the FK references agent_runs(id); handoffs self-root)
  assert.equal(runs[0]!.deliberation_root_id, null)
  assert.equal(runs[0]!.round_index, 1)
  assert.equal(runs[0]!.deliberation_depth, 2) // execute is stage 2
})

test('plan→execute: malformed plan falls back to round-robin (never stalls)', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('plan-msg', 0, ['completed'])
  seedPlanReply('no assignments here at all', 0)

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan-msg', content: '', metadata: discMeta('plan') },
  })

  const msgs = insertedMessages()
  assert.equal(msgs[0]!.metadata.discussion.assignments.length, 3)
  assert.equal(insertedRuns().length, 3)
})

test('integrate→dissent when no challenge (anti-sycophancy)', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('int-msg', 2, ['completed', 'completed', 'completed'])
  // no challenge message present in the thread

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 2,
    triggerMessage: { id: 'int-msg', content: '', metadata: discMeta('integrate') },
  })

  assert.equal(insertedMessages()[0]!.metadata.discussion.phase, 'dissent')
  assert.equal(insertedRuns().length, 3) // dissent fans to all
})

test('integrate→converge when a challenge exists; converge is coordinator-only', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('int-msg', 2, ['completed', 'completed', 'completed'])
  // a peer reply substantively challenged: metadata.discussion.challenge = true
  seedMessage(h.db, ROOM, {
    sender_type: 'agent',
    sender_agent_id: 'b',
    content: 'I disagree, @alpha overlooks a risk',
    round_index: 2,
    metadata: JSON.stringify({
      discussion: {
        enabled: true,
        command: 'discuss',
        phase: 'integrate',
        original_message_id: ROOT,
        challenge: true,
      },
    }),
  })

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 2,
    triggerMessage: { id: 'int-msg', content: '', metadata: discMeta('integrate') },
  })

  const msgs = insertedMessages()
  assert.equal(msgs[0]!.metadata.discussion.phase, 'converge')
  const runs = insertedRuns()
  assert.equal(runs.length, 1) // only the coordinator converges
  assert.equal(runs[0]!.agent_id, 'a')
})

test('converge is terminal — schedules nothing further', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('conv-msg', 3, ['completed'])

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 3,
    triggerMessage: { id: 'conv-msg', content: '', metadata: discMeta('converge') },
  })

  assert.equal(insertedMessages().length, 0)
  assert.equal(insertedRuns().length, 0)
})

test('does not advance when the phase produced no completed run (all failed)', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('exec-msg', 1, ['failed', 'failed'])

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 1,
    triggerMessage: { id: 'exec-msg', content: '', metadata: discMeta('execute') },
  })

  assert.equal(insertedMessages().length, 0)
})

test('idempotency: does not schedule a phase that already exists', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('plan-msg', 0, ['completed'])
  seedPlanReply('@alpha: a', 0)
  // The next phase (execute) message already exists in this thread.
  seedMessage(h.db, ROOM, {
    sender_type: 'system',
    content: 'already scheduled execute',
    round_index: 1,
    metadata: JSON.stringify({
      discussion: { enabled: true, command: 'discuss', phase: 'execute', original_message_id: ROOT },
    }),
  })

  const before = insertedMessages().length // 1 (the pre-seeded execute message)
  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan-msg', content: '', metadata: discMeta('plan') },
  })

  // No NEW message inserted, and no runs queued.
  assert.equal(insertedMessages().length, before)
  assert.equal(insertedRuns().length, 0)
})

test('debate: assign→argue fans to all with distinct positions; rebut→adjudicate is coordinator', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('assign-msg', 0, ['completed'])
  seedPlanReply('no parse', 0)

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 0,
    triggerMessage: { id: 'assign-msg', content: '', metadata: discMeta('assign', 'debate') },
  })

  const msgs = insertedMessages()
  assert.equal(msgs[0]!.metadata.discussion.phase, 'argue')
  assert.equal(insertedRuns().length, 3)
  // debate fallback gives distinct positions
  const positions = msgs[0]!.metadata.discussion.assignments.map((a: any) => a.position)
  assert.deepEqual([...new Set(positions)].sort(), ['against', 'alternative', 'for'])
})

test('caps fan-out to COLLAB_MAX_AGENTS in a large room (keeps coordinator)', async () => {
  const big = ['a', 'b', 'c', 'd', 'e'].map((s) => ({ id: s, slug: s }))
  seedRoomWithMembers(big)
  seedPhaseRuns('plan', 0, ['completed'])
  seedPlanReply('no parse', 0)

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan', content: '', metadata: discMeta('plan') },
  })

  const runs = insertedRuns()
  // 5 active agents, but execute fans to at most COLLAB_MAX_AGENTS (3)
  assert.equal(runs.length, 3)
  // the coordinator (a) is retained
  assert.ok(runs.some((r) => r.agent_id === 'a'))
})

test('stamps anti_sycophancy when converging from dissent with no challenge', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('dissent-msg', 3, ['completed', 'completed', 'completed'])
  // no challenge message in the thread

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 3,
    triggerMessage: { id: 'dissent-msg', content: '', metadata: discMeta('dissent') },
  })

  const msg = insertedMessages()[0]!
  assert.equal(msg.metadata.discussion.phase, 'converge')
  assert.equal(msg.metadata.discussion.anti_sycophancy, 'no_challenge_after_dissent')
})

test('not a discussion → no-op', async () => {
  seedRoomWithMembers(MEMBERS)
  seedPhaseRuns('m', 0, ['completed'])

  await maybeScheduleDiscussionContinuation({
    roomId: ROOM,
    currentRoundIndex: 0,
    triggerMessage: { id: 'm', content: '', metadata: {} },
  })

  assert.equal(insertedMessages().length, 0)
})
