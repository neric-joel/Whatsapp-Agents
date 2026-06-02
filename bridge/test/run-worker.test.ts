import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import type { AgentAdapter, AgentEvent, ContextPacketV1 } from '@agentroom/shared'

import { __resetMetrics, snapshotCounters } from '../src/lib/metrics.js'
import { processRun } from '../src/workers/run-worker.js'

// ---------------------------------------------------------------------------
// A flexible, stateful fake Supabase client. Every query builder method returns
// the builder; `.single()` and awaiting the builder both resolve through a single
// `resolve(ctx)` router the test supplies, so we can drive the full run state
// machine (claim → running → adapter → terminal) and assert the terminal write.
// ---------------------------------------------------------------------------

interface QueryCtx {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  fields?: string
  values?: Record<string, unknown>
  single: boolean
}

type Resolver = (ctx: QueryCtx) => { data: unknown; error: unknown }

function makeFakeSupabase(resolve: Resolver) {
  return {
    from(table: string) {
      const ctx: QueryCtx = { table, op: 'select', single: false }
      const builder: Record<string, unknown> = {
        select(fields?: string) {
          if (ctx.op === 'select') ctx.fields = fields
          return builder
        },
        insert(values: Record<string, unknown>) {
          ctx.op = 'insert'
          ctx.values = values
          return builder
        },
        update(values: Record<string, unknown>) {
          ctx.op = 'update'
          ctx.values = values
          return builder
        },
        delete() {
          ctx.op = 'delete'
          return builder
        },
        eq() {
          return builder
        },
        lte() {
          return builder
        },
        in() {
          return builder
        },
        or() {
          return builder
        },
        order() {
          return builder
        },
        limit() {
          return builder
        },
        single() {
          ctx.single = true
          return Promise.resolve(resolve(ctx))
        },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          return Promise.resolve(resolve(ctx)).then(onF, onR)
        },
      }
      return builder
    },
  }
}

const ROOM = {
  id: 'room-1',
  name: 'Test Room',
  reply_mode: 'everyone',
  max_agent_rounds: 5,
  discussion_mode: 'independent',
}

const RUN_ROW = {
  id: 'run-1',
  room_id: 'room-1',
  agent_id: 'agent-1',
  trigger_msg_id: null,
  status: 'queued',
  round_index: 0,
  discussion_mode: 'independent',
  deliberation_depth: 0,
  deliberation_root_id: null,
  agents: {
    id: 'agent-1',
    name: 'Mock',
    slug: 'mock',
    system_prompt: null,
    provider: 'mock',
    adapter_type: 'mock',
    tool_permissions: {},
  },
}

/** Build a resolver + a record of every agent_runs terminal (non-select) write. */
function makeHarness(opts: { status: () => string; messageInsertError?: boolean }) {
  const runUpdates: Array<Record<string, unknown>> = []
  const resolve: Resolver = (ctx) => {
    if (ctx.table === 'agent_runs') {
      if (ctx.op === 'update') {
        const v = ctx.values ?? {}
        // claim / running transitions return the row id so the worker proceeds.
        if (v.status === 'claimed' || v.status === 'running') {
          return { data: { id: 'run-1' }, error: null }
        }
        // terminal transitions (completed/failed/cancelled) are awaited directly.
        runUpdates.push(v)
        // The completed write is status-guarded with `.select('id')`; return a row
        // so the worker treats it as a real (non-no-op) terminal write.
        return { data: [{ id: 'run-1' }], error: null }
      }
      // selects: the watcher polls only `status`; the worker's initial fetch
      // pulls the full row.
      if (ctx.fields === 'status') return { data: { status: opts.status() }, error: null }
      return { data: RUN_ROW, error: null }
    }
    if (ctx.table === 'rooms') return { data: ROOM, error: null }
    if (ctx.table === 'messages') {
      if (ctx.op === 'insert') {
        return opts.messageInsertError
          ? { data: null, error: { message: 'insert failed' } }
          : { data: { id: 'msg-1' }, error: null }
      }
      return { data: [], error: null } // recent messages
    }
    if (ctx.table === 'pinned_items') return { data: [], error: null }
    if (ctx.table === 'files') return { data: [], error: null }
    return { data: null, error: null }
  }
  return { resolve, runUpdates }
}

/** Adapter whose behavior is scripted by a generator factory. */
function fakeAdapter(
  gen: (packet: ContextPacketV1, signal: AbortSignal) => AsyncGenerator<AgentEvent>,
): AgentAdapter {
  return { run: gen }
}

beforeEach(() => __resetMetrics())

test('induced child crash (adapter error event) → run marked failed, re-thrown, counted', async () => {
  const { resolve, runUpdates } = makeHarness({ status: () => 'running' })
  const supabase = makeFakeSupabase(resolve) as never

  const adapter = fakeAdapter(async function* (packet) {
    yield { type: 'error', run_id: packet.run_id, message: 'child crashed' }
  })

  await assert.rejects(
    processRun('run-1', { supabase, getAdapter: () => adapter }),
    /child crashed/,
  )

  assert.equal(runUpdates.length, 1, 'exactly one terminal write — no lost run')
  assert.equal(runUpdates[0]?.status, 'failed')
  assert.match(String(runUpdates[0]?.error_message), /child crashed/)
  assert.equal(snapshotCounters().runs_failed, 1)
})

test('bad agent output (no final_response) → run marked failed, no hang', async () => {
  const { resolve, runUpdates } = makeHarness({ status: () => 'running' })
  const supabase = makeFakeSupabase(resolve) as never
  // Yields a non-final visible message then ends — never produces final_response.
  const adapter = fakeAdapter(async function* (packet) {
    yield { type: 'visible_message', run_id: packet.run_id, content: 'thinking...' }
  })

  await assert.rejects(
    processRun('run-1', { supabase, getAdapter: () => adapter }),
    /no final_response/,
  )

  assert.equal(runUpdates.length, 1)
  assert.equal(runUpdates[0]?.status, 'failed')
  assert.equal(snapshotCounters().runs_failed, 1)
})

test('DB error inserting the reply → run marked failed (clean state, no lost run)', async () => {
  const { resolve, runUpdates } = makeHarness({ status: () => 'running', messageInsertError: true })
  const supabase = makeFakeSupabase(resolve) as never
  const adapter = fakeAdapter(async function* (packet) {
    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: { schema_version: 1, run_id: packet.run_id, content: 'done', content_type: 'text' },
    }
  })

  await assert.rejects(
    processRun('run-1', { supabase, getAdapter: () => adapter }),
    /insert failed/,
  )

  assert.equal(runUpdates.length, 1)
  assert.equal(runUpdates[0]?.status, 'failed')
  assert.equal(snapshotCounters().runs_failed, 1)
})

test('memory_op event is handled and a failing memory write does NOT break the run', async () => {
  // agent_memory writes resolve to {data:null} in this harness → persistMemoryOp
  // treats it as a failure. The run must still complete (memory is best-effort).
  const { resolve, runUpdates } = makeHarness({ status: () => 'running' })
  const supabase = makeFakeSupabase(resolve) as never
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

  await processRun('run-1', { supabase, getAdapter: () => adapter })

  assert.equal(runUpdates.length, 1, 'exactly one terminal write')
  assert.equal(runUpdates[0]?.status, 'completed', 'run completes despite the failed memory write')
  assert.equal(snapshotCounters().runs_completed, 1)
  assert.equal(snapshotCounters().runs_failed, 0)
})

test('handoff_requested event creates a targeted peer run and the source run completes', async () => {
  // Bespoke resolver shaped for the hand-off queries (rooms guards, room peer,
  // chain lookup, dedup, targeted insert) — proves the run-worker wiring end to end.
  const targetInserts: Array<Record<string, unknown>> = []
  const runUpdates: Array<Record<string, unknown>> = []
  const resolve: Resolver = (ctx) => {
    if (ctx.table === 'agent_runs') {
      if (ctx.op === 'insert') {
        targetInserts.push(ctx.values ?? {})
        return { data: { id: 'peer-run' }, error: null }
      }
      if (ctx.op === 'update') {
        const v = ctx.values ?? {}
        if (v.status === 'claimed' || v.status === 'running')
          return { data: { id: 'run-1' }, error: null }
        runUpdates.push(v)
        // The completed write is status-guarded with `.select('id')`; return a row
        // so the worker treats it as a real (non-no-op) terminal write.
        return { data: [{ id: 'run-1' }], error: null }
      }
      if (ctx.fields === 'status') return { data: { status: 'running' }, error: null }
      // collectChainAgents: root run (single) → source agent; descendants → []
      if (ctx.fields === 'agent_id')
        return ctx.single
          ? { data: { agent_id: 'agent-1' }, error: null }
          : { data: [], error: null }
      if (ctx.fields === 'id') return { data: [], error: null } // dedup → none
      return { data: RUN_ROW, error: null } // initial full fetch
    }
    if (ctx.table === 'rooms')
      return {
        data: {
          id: 'room-1',
          name: 'Test Room',
          reply_mode: 'everyone',
          max_agent_rounds: 5,
          discussion_mode: 'independent',
          allow_agent_to_agent: true,
          max_agent_hops: 6,
        },
        error: null,
      }
    if (ctx.table === 'room_members')
      return {
        data: [
          {
            agent_id: 'agent-B',
            agents: {
              id: 'agent-B',
              name: 'Reviewer',
              slug: 'reviewer',
              capabilities: null,
              is_active: true,
            },
          },
        ],
        error: null,
      }
    if (ctx.table === 'messages') {
      if (ctx.op === 'insert') return { data: { id: 'reply-1' }, error: null }
      return { data: [], error: null }
    }
    if (ctx.table === 'pinned_items') return { data: [], error: null }
    if (ctx.table === 'files') return { data: [], error: null }
    return { data: null, error: null }
  }
  const supabase = makeFakeSupabase(resolve) as never
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

  await processRun('run-1', { supabase, getAdapter: () => adapter })

  assert.equal(targetInserts.length, 1, 'one targeted peer run created')
  assert.equal(targetInserts[0]?.agent_id, 'agent-B')
  assert.equal(targetInserts[0]?.round_index, 1)
  assert.equal(targetInserts[0]?.deliberation_depth, 1)
  assert.equal(targetInserts[0]?.trigger_msg_id, 'reply-1')
  assert.equal(runUpdates.at(-1)?.status, 'completed', 'source run still completes')
  assert.equal(snapshotCounters().runs_completed, 1)
})

test('a hand-off that resolves to an unknown peer does not break the run', async () => {
  // Default harness returns no room_members → handoff blocked (unknown_target).
  const { resolve, runUpdates } = makeHarness({ status: () => 'running' })
  const supabase = makeFakeSupabase(resolve) as never
  const adapter = fakeAdapter(async function* (packet) {
    yield { type: 'handoff_requested', run_id: packet.run_id, to_agent_slug: 'ghost', reason: 'x' }
    yield {
      type: 'final_response',
      run_id: packet.run_id,
      response: { schema_version: 1, run_id: packet.run_id, content: 'done', content_type: 'text' },
    }
  })

  await processRun('run-1', { supabase, getAdapter: () => adapter })

  assert.equal(runUpdates.length, 1)
  assert.equal(runUpdates[0]?.status, 'completed', 'a blocked hand-off never fails the run')
})

test('R3: a post-completion follow-up failure never clobbers a completed run to failed', async () => {
  // The run completes (message inserted, status→completed), then a follow-up
  // (mention scheduling — which has NO internal try/catch) throws. The worker must
  // swallow that best-effort failure and leave the run 'completed', NOT flip it to
  // 'failed'. Without the fix, the throw reaches the outer catch and clobbers it.
  __resetMetrics()
  let completedSeen = false
  const runUpdates: Array<Record<string, unknown>> = []
  const resolve: Resolver = (ctx) => {
    if (ctx.table === 'agent_runs') {
      if (ctx.op === 'update') {
        const v = ctx.values ?? {}
        if (v.status === 'claimed' || v.status === 'running')
          return { data: { id: 'run-1' }, error: null }
        runUpdates.push(v)
        if (v.status === 'completed') completedSeen = true
        return { data: [{ id: 'run-1' }], error: null }
      }
      // Any agent_runs read AFTER the completed write belongs to a follow-up — explode.
      if (completedSeen) throw new Error('follow-up scheduling boom')
      if (ctx.fields === 'status') return { data: { status: 'running' }, error: null }
      // tag_turns so maybeScheduleAgentMentionFollowUps proceeds PAST its early-return
      // (agent-follow-up.ts:49) into the post-completion rooms read, which throws below.
      return { data: { ...RUN_ROW, discussion_mode: 'tag_turns' }, error: null }
    }
    if (ctx.table === 'rooms') {
      if (completedSeen) throw new Error('follow-up scheduling boom')
      return { data: ROOM, error: null }
    }
    if (ctx.table === 'room_members') {
      if (completedSeen) throw new Error('follow-up scheduling boom')
      return { data: [], error: null }
    }
    if (ctx.table === 'messages') {
      if (ctx.op === 'insert') return { data: { id: 'msg-1' }, error: null }
      if (completedSeen) throw new Error('follow-up scheduling boom')
      return { data: [], error: null }
    }
    if (ctx.table === 'pinned_items') return { data: [], error: null }
    if (ctx.table === 'files') return { data: [], error: null }
    return { data: null, error: null }
  }
  const supabase = makeFakeSupabase(resolve) as never
  // tag_turns mode makes the mention-followup path (no internal try/catch) issue a
  // post-completion rooms read, which the resolver throws on — exercising the fix.
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

  // Must NOT reject: the run completed; the follow-up failure is best-effort.
  await processRun('run-1', { supabase, getAdapter: () => adapter })

  assert.deepEqual(
    runUpdates.map((u) => u.status),
    ['completed'],
    'exactly one terminal write = completed; no failed clobber',
  )
  assert.equal(snapshotCounters().runs_completed, 1)
  assert.equal(snapshotCounters().runs_failed, 0)
})

test('cancellation mid-run → run marked cancelled, child aborted, not re-thrown', async () => {
  let status = 'running'
  const { resolve, runUpdates } = makeHarness({ status: () => status })
  const supabase = makeFakeSupabase(resolve) as never
  // Adapter waits for the abort signal (the cancellation watcher flips status).
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
    status = 'cancelled'
  }, 50)

  await processRun('run-1', { supabase, getAdapter: () => adapter })

  assert.equal(runUpdates.length, 1, 'exactly one terminal write')
  assert.equal(runUpdates[0]?.status, 'cancelled')
  assert.equal(snapshotCounters().runs_cancelled, 1)
  assert.equal(snapshotCounters().runs_failed, 0)
})
