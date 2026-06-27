import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { maybeScheduleAgentMentionFollowUps } from '../src/lib/agent-follow-up.js'

import {
  freshTestDb,
  seedAgent,
  seedMember,
  seedRoom,
  seedRun,
  type TestDb,
} from './helpers/test-db.js'

/**
 * The bridge module reads from the local SQLite DB via getDb() and writes follow-up
 * runs into agent_runs. The original test passed a Supabase mock and asserted on the
 * rows it would have inserted; this version seeds real rows and asserts on the actual
 * agent_runs table state.
 *
 * Shared fixtures across every case:
 *   - a room with the relevant max_agent_rounds (controls deliberation depth cap),
 *   - two agent members of that room, both reply_enabled + unmuted + active:
 *       'source'   (slug codex_builder, name "Codex Builder")  -> the replying agent
 *       'reviewer' (slug reviewer,     name "Reviewer")        -> the @-mention target
 */

let h: TestDb

/** Read all follow-up rows for a trigger message, ordered, for assertions. */
function runsForTrigger(triggerMsgId: string): Array<Record<string, unknown>> {
  return h.db
    .prepare(
      `SELECT room_id, agent_id, trigger_msg_id, status, round_index,
              discussion_mode, deliberation_depth, deliberation_root_id
         FROM agent_runs
        WHERE trigger_msg_id = ?
        ORDER BY agent_id`,
    )
    .all(triggerMsgId) as Array<Record<string, unknown>>
}

function countAgentRuns(): number {
  return (h.db.prepare('SELECT COUNT(*) AS n FROM agent_runs').get() as { n: number }).n
}

/**
 * Seed the room + its two agent members. `roomOverrides` lets a case set
 * max_agent_rounds / discussion_mode the way the old createSupabaseStub options did.
 */
function seedRoomWithMembers(roomOverrides: Record<string, unknown> = {}): void {
  seedRoom(h.db, {
    id: 'room-1',
    name: 'Test Room',
    max_agent_rounds: 4,
    discussion_mode: 'tag_turns',
    ...roomOverrides,
  })

  seedAgent(h.db, {
    id: 'source',
    name: 'Codex Builder',
    slug: 'codex_builder',
    is_active: 1,
  })
  seedAgent(h.db, {
    id: 'reviewer',
    name: 'Reviewer',
    slug: 'reviewer',
    is_active: 1,
  })

  seedMember(h.db, 'room-1', {
    agent_id: 'source',
    member_type: 'agent',
    reply_enabled: 1,
    muted: 0,
  })
  seedMember(h.db, 'room-1', {
    agent_id: 'reviewer',
    member_type: 'agent',
    reply_enabled: 1,
    muted: 0,
  })
}

beforeEach(() => {
  h = freshTestDb()
})

afterEach(() => {
  h.cleanup()
})

test('agent reply in independent mode with @mention creates no follow-up', async () => {
  seedRoomWithMembers()

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-1',
      discussion_mode: 'independent',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, [])
  assert.equal(countAgentRuns(), 0)
})

test('current run tag_turns mode allows follow-up even if the room default is independent', async () => {
  // Room default is independent, but the current run is tag_turns: the run mode wins.
  seedRoomWithMembers({ discussion_mode: 'independent' })

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.equal(countAgentRuns(), 1)
})

test('agent reply in tag_turns mode with @mention creates exactly the mentioned follow-up run', async () => {
  seedRoomWithMembers()

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.deepEqual(runsForTrigger('message-1'), [
    {
      room_id: 'room-1',
      agent_id: 'reviewer',
      trigger_msg_id: 'message-1',
      status: 'queued',
      round_index: 1,
      discussion_mode: 'tag_turns',
      deliberation_depth: 1,
      // root_id was null on the current run -> falls back to the current run's id.
      deliberation_root_id: 'run-1',
    },
  ])
})

test('agent reply with no mention creates no follow-up', async () => {
  seedRoomWithMembers()

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: 'I think we have a conclusion.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, [])
  assert.equal(countAgentRuns(), 0)
})

test('agent reply at max deliberation depth creates no follow-up', async () => {
  // max_agent_rounds=2 -> maxDepth=1; the current run is already at depth 1, so it caps.
  seedRoomWithMembers({ max_agent_rounds: 2 })

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 1,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 1,
  })

  assert.deepEqual(targets, [])
  assert.equal(countAgentRuns(), 0)
})

test('follow-up runs propagate existing deliberation root and increment depth', async () => {
  seedRoomWithMembers()

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-2',
      discussion_mode: 'tag_turns',
      deliberation_depth: 2,
      deliberation_root_id: 'root-run',
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-2',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 2,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.deepEqual(runsForTrigger('message-2'), [
    {
      room_id: 'room-1',
      agent_id: 'reviewer',
      trigger_msg_id: 'message-2',
      status: 'queued',
      round_index: 3,
      discussion_mode: 'tag_turns',
      deliberation_depth: 3,
      // existing root is propagated, NOT replaced by the current run id.
      deliberation_root_id: 'root-run',
    },
  ])
})

test('duplicate mentions do not create duplicate follow-up runs', async () => {
  seedRoomWithMembers()

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer @reviewer @Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, ['reviewer'])
  assert.equal(countAgentRuns(), 1)
})

test('an already-scheduled run for the same trigger+round is not duplicated', async () => {
  // Preserves the dedup intent the old test expressed via the existingRuns stub option:
  // if a run for this target already exists for the next round, no new run is inserted.
  seedRoomWithMembers()

  // The source schedules into roundIndex+1 = 1; pre-seed reviewer's run for round 1.
  seedRun(h.db, 'room-1', 'reviewer', {
    id: 'existing-run',
    trigger_msg_id: 'message-1',
    round_index: 1,
    status: 'queued',
    discussion_mode: 'tag_turns',
    deliberation_depth: 1,
    deliberation_root_id: 'run-1',
  })

  const targets = await maybeScheduleAgentMentionFollowUps({
    currentRun: {
      id: 'run-1',
      discussion_mode: 'tag_turns',
      deliberation_depth: 0,
      deliberation_root_id: null,
    },
    roomId: 'room-1',
    sourceAgentId: 'source',
    sourceMessageId: 'message-1',
    replyContent: '@Reviewer please challenge this.',
    roundIndex: 0,
  })

  assert.deepEqual(targets, [])
  // Only the pre-seeded run remains; no second one was inserted.
  assert.equal(countAgentRuns(), 1)
})
