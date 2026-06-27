import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import type { AgentAdapter, AgentEvent, ContextPacketV1 } from '@agentroom/shared'

import { __resetMetrics, snapshotCounters } from '../src/lib/metrics.js'
import { processRun } from '../src/workers/run-worker.js'

import {
  freshTestDb,
  seedAgent,
  seedMember,
  seedMessage,
  seedRoom,
  seedRun,
  type TestDb,
} from './helpers/test-db.js'

// ---------------------------------------------------------------------------
// Migrated from the mocked-Supabase version. The source (processRun) now calls
// getDb() internally and takes NO supabase arg, so every test seeds the rows the
// worker reads (room + agent + trigger message + a QUEUED agent_run 'run-1') into a
// real temp SQLite DB and drives the run-state machine through the live schema.
//
// The adapter is still injected (deps.getAdapter); only the supabase plumbing is
// gone. Where the old test asserted on "what was written to supabase" (the terminal
// update values / inserted reply), this version asserts on the ACTUAL agent_runs /
// messages rows the worker wrote, plus the in-process metrics counters.
// ---------------------------------------------------------------------------

let h: TestDb

/** Seed the standard world: a room, a mock-adapter agent, a trigger message, and a
 *  QUEUED run 'run-1' wired to all three. Overrides let a case tweak the room/run. */
function seedWorld(opts: {
  room?: Record<string, unknown>
  run?: Record<string, unknown>
  triggerMsg?: Record<string, unknown> | null
} = {}): void {
  seedRoom(h.db, {
    id: 'room-1',
    name: 'Test Room',
    reply_mode: 'everyone',
    max_agent_rounds: 5,
    discussion_mode: 'independent',
    allow_agent_to_agent: 1,
    max_agent_hops: 6,
    ...opts.room,
  })
  seedAgent(h.db, {
    id: 'agent-1',
    name: 'Mock',
    slug: 'mock',
    provider: 'mock',
    adapter_type: 'mock',
    system_prompt: null,
    tool_permissions: '{}',
    is_active: 1,
  })
  // The acting agent is a member of the room (so the worker can build its packet).
  seedMember(h.db, 'room-1', {
    agent_id: 'agent-1',
    member_type: 'agent',
    reply_enabled: 1,
    muted: 0,
  })

  // Trigger message (null = run has no trigger_msg_id; the worker uses its fallback).
  const triggerId =
    opts.triggerMsg === null
      ? null
      : ((opts.triggerMsg?.id as string | undefined) ?? 'trigger-1')
  if (opts.triggerMsg !== null) {
    seedMessage(h.db, 'room-1', {
      id: triggerId as string,
      sender_type: 'user',
      content: 'hello there',
      round_index: 0,
      ...opts.triggerMsg,
    })
  }

  seedRun(h.db, 'room-1', 'agent-1', {
    id: 'run-1',
    status: 'queued',
    trigger_msg_id: triggerId,
    round_index: 0,
    discussion_mode: 'independent',
    deliberation_depth: 0,
    deliberation_root_id: null,
    ...opts.run,
  })
}

/** The run row's current terminal-relevant fields. */
function runRow(id = 'run-1'): {
  status: string
  error_message: string | null
  completed_at: string | null
} {
  return h.db
    .prepare('SELECT status, error_message, completed_at FROM agent_runs WHERE id = ?')
    .get(id) as { status: string; error_message: string | null; completed_at: string | null }
}

/** All agent reply messages the worker inserted for the room. */
function agentReplies(roomId = 'room-1'): Array<{ content: string; round_index: number; metadata: string }> {
  return h.db
    .prepare(
      "SELECT content, round_index, metadata FROM messages WHERE room_id = ? AND sender_type = 'agent' ORDER BY created_at",
    )
    .all(roomId) as Array<{ content: string; round_index: number; metadata: string }>
}

/** Adapter whose behavior is scripted by a generator factory. */
function fakeAdapter(
  gen: (packet: ContextPacketV1, signal: AbortSignal) => AsyncGenerator<AgentEvent>,
): AgentAdapter {
  return { run: gen }
}

beforeEach(() => {
  __resetMetrics()
  h = freshTestDb()
})

afterEach(() => {
  h.cleanup()
})

test('induced child crash (adapter error event) → run marked failed, re-thrown, counted', async () => {
  seedWorld()

  const adapter = fakeAdapter(async function* (packet) {
    yield { type: 'error', run_id: packet.run_id, message: 'child crashed' }
  })

  await assert.rejects(
    processRun('run-1', { getAdapter: () => adapter }),
    /child crashed/,
  )

  // The single terminal write moved the run to 'failed' with the error recorded.
  const row = runRow()
  assert.equal(row.status, 'failed', 'exactly one terminal status — failed; no lost run')
  assert.match(String(row.error_message), /child crashed/)
  // No reply message should have been inserted for a crashed run.
  assert.equal(agentReplies().length, 0)
  assert.equal(snapshotCounters().runs_failed, 1)
})

test('bad agent output (no final_response) → run marked failed, no hang', async () => {
  seedWorld()
  // Yields a non-final visible message then ends — never produces final_response.
  const adapter = fakeAdapter(async function* (packet) {
    yield { type: 'visible_message', run_id: packet.run_id, content: 'thinking...' }
  })

  await assert.rejects(
    processRun('run-1', { getAdapter: () => adapter }),
    /no final_response/,
  )

  const row = runRow()
  assert.equal(row.status, 'failed')
  assert.equal(agentReplies().length, 0)
  assert.equal(snapshotCounters().runs_failed, 1)
})

test('DB error inserting the reply → run marked failed (clean state, no lost run)', async () => {
  seedWorld()
  const adapter = fakeAdapter(async function* (packet) {
    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: { schema_version: 1, run_id: packet.run_id, content: 'done', content_type: 'text' },
    }
  })

  // Force the reply INSERT to fail the way the old harness simulated a Supabase
  // insert error: intercept the exact reply-insert prepare and throw. (The worker's
  // outer catch then status-guards the run to 'failed' and re-throws.)
  const realPrepare = h.db.prepare.bind(h.db)
  const REPLY_INSERT = 'INSERT INTO messages (id, room_id, sender_type, sender_agent_id'
  ;(h.db as { prepare: typeof h.db.prepare }).prepare = ((sql: string) => {
    if (typeof sql === 'string' && sql.startsWith(REPLY_INSERT)) {
      throw new Error('insert failed')
    }
    return realPrepare(sql)
  }) as typeof h.db.prepare

  try {
    await assert.rejects(
      processRun('run-1', { getAdapter: () => adapter }),
      /insert failed/,
    )
  } finally {
    ;(h.db as { prepare: typeof h.db.prepare }).prepare = realPrepare
  }

  const row = runRow()
  assert.equal(row.status, 'failed')
  // The reply was never persisted (the insert threw).
  assert.equal(agentReplies().length, 0)
  assert.equal(snapshotCounters().runs_failed, 1)
})

test('memory_op event is handled and a failing memory write does NOT break the run', async () => {
  // Make the agent_memory INSERT fail (persistMemoryOp treats it as a non-fatal
  // failure) to prove a bad memory write never fails the run. The run must still
  // complete (memory is best-effort) and a reply must be inserted.
  seedWorld()
  const adapter = fakeAdapter(async function* (packet) {
    yield {
      type: 'memory_op',
      run_id: packet.run_id,
      op: 'add',
      scope: 'room',
      kind: 'fact',
      content: 'the deadline is Friday',
    }
    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: {
        schema_version: 1,
        run_id: packet.run_id,
        content: 'noted',
        content_type: 'text',
      },
    }
  })

  // Intercept the agent_memory INSERT so persistMemoryOp's write fails (best-effort).
  const realPrepare = h.db.prepare.bind(h.db)
  ;(h.db as { prepare: typeof h.db.prepare }).prepare = ((sql: string) => {
    if (typeof sql === 'string' && sql.includes('INSERT INTO agent_memory')) {
      throw new Error('memory write boom')
    }
    return realPrepare(sql)
  }) as typeof h.db.prepare

  try {
    await processRun('run-1', { getAdapter: () => adapter })
  } finally {
    ;(h.db as { prepare: typeof h.db.prepare }).prepare = realPrepare
  }

  const row = runRow()
  assert.equal(row.status, 'completed', 'run completes despite the failed memory write')
  // The reply was still inserted.
  assert.equal(agentReplies().length, 1)
  assert.equal(agentReplies()[0]!.content, 'noted')
  // No memory row was persisted (the write failed, best-effort).
  assert.equal(
    (h.db.prepare('SELECT COUNT(*) AS n FROM agent_memory').get() as { n: number }).n,
    0,
  )
  assert.equal(snapshotCounters().runs_completed, 1)
  assert.equal(snapshotCounters().runs_failed, 0)
})

test('handoff_requested event creates a targeted peer run and the source run completes', async () => {
  // Source agent-1 + a peer agent-B (slug 'reviewer'), both active room members. The
  // hand-off resolves to agent-B and creates ONE targeted peer run; the source still
  // completes. Asserts on the actual targeted agent_runs row (it points at the
  // inserted reply as its trigger) — the real-DB analog of the old targetInserts spy.
  seedWorld({ room: { max_agent_rounds: 5, allow_agent_to_agent: 1, max_agent_hops: 6 } })
  seedAgent(h.db, {
    id: 'agent-B',
    name: 'Reviewer',
    slug: 'reviewer',
    provider: 'mock',
    adapter_type: 'mock',
    is_active: 1,
  })
  seedMember(h.db, 'room-1', {
    agent_id: 'agent-B',
    member_type: 'agent',
    reply_enabled: 1,
    muted: 0,
  })

  const adapter = fakeAdapter(async function* (packet) {
    yield {
      type: 'handoff_requested',
      run_id: packet.run_id,
      to_agent_slug: 'reviewer',
      reason: 'please review',
    }
    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: {
        schema_version: 1,
        run_id: packet.run_id,
        content: 'handing off',
        content_type: 'text',
      },
    }
  })

  await processRun('run-1', { getAdapter: () => adapter })

  // The source run completed and its reply was inserted.
  assert.equal(runRow().status, 'completed', 'source run still completes')
  const replies = agentReplies()
  assert.equal(replies.length, 1)
  assert.equal(replies[0]!.content, 'handing off')
  const replyId = (
    h.db
      .prepare("SELECT id FROM messages WHERE room_id = 'room-1' AND sender_type = 'agent'")
      .get() as { id: string }
  ).id

  // Exactly one targeted peer run was created, for agent-B, triggered by the reply,
  // at the next round/depth.
  const targeted = h.db
    .prepare(
      "SELECT agent_id, round_index, deliberation_depth, trigger_msg_id, status FROM agent_runs WHERE agent_id = 'agent-B'",
    )
    .all() as Array<{
    agent_id: string
    round_index: number
    deliberation_depth: number
    trigger_msg_id: string
    status: string
  }>
  assert.equal(targeted.length, 1, 'one targeted peer run created')
  assert.equal(targeted[0]!.agent_id, 'agent-B')
  assert.equal(targeted[0]!.round_index, 1)
  assert.equal(targeted[0]!.deliberation_depth, 1)
  assert.equal(targeted[0]!.trigger_msg_id, replyId)
  assert.equal(targeted[0]!.status, 'queued')
  assert.equal(snapshotCounters().runs_completed, 1)
})

test('a hand-off that resolves to an unknown peer does not break the run', async () => {
  // No peer named 'ghost' is a member → handoff blocked (unknown_target). The run
  // must still complete and never fail.
  seedWorld()
  const adapter = fakeAdapter(async function* (packet) {
    yield { type: 'handoff_requested', run_id: packet.run_id, to_agent_slug: 'ghost', reason: 'x' }
    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: { schema_version: 1, run_id: packet.run_id, content: 'done', content_type: 'text' },
    }
  })

  await processRun('run-1', { getAdapter: () => adapter })

  assert.equal(runRow().status, 'completed', 'a blocked hand-off never fails the run')
  assert.equal(agentReplies().length, 1)
  // No peer run was created for any other agent.
  assert.equal(
    (
      h.db
        .prepare("SELECT COUNT(*) AS n FROM agent_runs WHERE id != 'run-1'")
        .get() as { n: number }
    ).n,
    0,
  )
  assert.equal(snapshotCounters().runs_completed, 1)
})

test('R3: a post-completion follow-up failure never clobbers a completed run to failed', async () => {
  // The run completes (message inserted, status→completed), then a follow-up
  // (mention scheduling — which has NO internal try/catch) throws. The worker must
  // swallow that best-effort failure and leave the run 'completed', NOT flip it to
  // 'failed'. Without the fix, the throw reaches the outer catch and clobbers it.
  //
  // tag_turns mode makes maybeScheduleAgentMentionFollowUps proceed PAST its early
  // return into the post-completion `SELECT max_agent_rounds FROM rooms` read — a
  // query unique to the follow-up path. We intercept exactly that read and throw,
  // reproducing the old harness's "follow-up scheduling boom" after the completed write.
  seedWorld({ room: { discussion_mode: 'tag_turns' }, run: { discussion_mode: 'tag_turns' } })

  const adapter = fakeAdapter(async function* (packet) {
    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: {
        schema_version: 1,
        run_id: packet.run_id,
        content: '@reviewer please take a look',
        content_type: 'text',
      },
    }
  })

  // The follow-up path's first DB call is this exact (unique) query; it runs ONLY
  // after the completed write. Throwing here exercises the R3 best-effort swallow.
  const realPrepare = h.db.prepare.bind(h.db)
  const FOLLOWUP_ROOMS_READ = 'SELECT max_agent_rounds FROM rooms WHERE id = ?'
  ;(h.db as { prepare: typeof h.db.prepare }).prepare = ((sql: string) => {
    if (sql === FOLLOWUP_ROOMS_READ) throw new Error('follow-up scheduling boom')
    return realPrepare(sql)
  }) as typeof h.db.prepare

  try {
    // Must NOT reject: the run completed; the follow-up failure is best-effort.
    await processRun('run-1', { getAdapter: () => adapter })
  } finally {
    ;(h.db as { prepare: typeof h.db.prepare }).prepare = realPrepare
  }

  // Exactly one terminal state = completed; no failed clobber.
  assert.equal(runRow().status, 'completed', 'exactly one terminal write = completed; no failed clobber')
  assert.equal(agentReplies().length, 1)
  assert.equal(snapshotCounters().runs_completed, 1)
  assert.equal(snapshotCounters().runs_failed, 0)
})

test('cancellation mid-run → run marked cancelled, child aborted, not re-thrown', async () => {
  seedWorld()
  // Adapter waits for the abort signal (the cancellation watcher flips the controller).
  const adapter = fakeAdapter(async function* (packet, signal) {
    await new Promise<void>((r) => {
      if (signal.aborted) return r()
      signal.addEventListener('abort', () => r(), { once: true })
      setTimeout(r, 5000) // safety; should be aborted well before this
    })
    yield { type: 'error', run_id: packet.run_id, message: 'aborted' }
  })

  // Flip the DB status to 'cancelled' so the 1s watcher aborts the controller.
  setTimeout(() => {
    h.db.prepare("UPDATE agent_runs SET status = 'cancelled' WHERE id = 'run-1'").run()
  }, 50)

  await processRun('run-1', { getAdapter: () => adapter })

  // The run is cancelled (terminal), not failed; no reply inserted; counted once.
  assert.equal(runRow().status, 'cancelled')
  assert.equal(agentReplies().length, 0)
  assert.equal(snapshotCounters().runs_cancelled, 1)
  assert.equal(snapshotCounters().runs_failed, 0)
})
