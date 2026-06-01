import assert from 'node:assert/strict'
import { test } from 'node:test'

import { handleHandoffRequest } from '../src/agents/handoff.js'

interface FakeOpts {
  room?: { allow_agent_to_agent: boolean; max_agent_rounds: number; max_agent_hops: number } | null
  members?: Array<{ agent_id: string; slug: string; is_active: boolean }>
  rootAgentId?: string | null
  chainDescendants?: string[]
  existingDup?: boolean
  insertError?: boolean
}

function makeFake(opts: FakeOpts) {
  const room =
    opts.room === undefined
      ? { allow_agent_to_agent: true, max_agent_rounds: 3, max_agent_hops: 6 }
      : opts.room
  const members = opts.members ?? []
  const runInserts: Array<Record<string, unknown>> = []
  const systemMessages: string[] = []

  function resolve(ctx: {
    table: string
    op: string
    filters: Array<[string, unknown]>
    values?: Record<string, unknown>
  }) {
    const has = (col: string) => ctx.filters.some((f) => f[0] === col)
    if (ctx.table === 'rooms') return { data: room, error: null }
    if (ctx.table === 'room_members') {
      return {
        data: members.map((m) => ({
          agent_id: m.agent_id,
          agents: { id: m.agent_id, slug: m.slug, is_active: m.is_active },
        })),
        error: null,
      }
    }
    if (ctx.table === 'agent_runs') {
      if (ctx.op === 'insert') {
        if (ctx.values) runInserts.push(ctx.values)
        return { data: null, error: opts.insertError ? { message: 'insert failed' } : null }
      }
      if (has('id')) return { data: { agent_id: opts.rootAgentId ?? null }, error: null }
      if (has('deliberation_root_id'))
        return { data: (opts.chainDescendants ?? []).map((a) => ({ agent_id: a })), error: null }
      if (has('trigger_msg_id'))
        return { data: opts.existingDup ? [{ id: 'dup' }] : [], error: null }
      return { data: [], error: null }
    }
    if (ctx.table === 'messages') {
      if (ctx.op === 'insert' && typeof ctx.values?.content === 'string') {
        systemMessages.push(ctx.values.content)
      }
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }

  function chain(table: string) {
    const ctx: {
      table: string
      op: string
      filters: Array<[string, unknown]>
      values?: Record<string, unknown>
    } = {
      table,
      op: 'select',
      filters: [],
    }
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select() {
        return c
      },
      insert(values: Record<string, unknown>) {
        ctx.op = 'insert'
        ctx.values = values
        return c
      },
      eq(col: string, val: unknown) {
        ctx.filters.push([col, val])
        return c
      },
      limit() {
        return c
      },
      single() {
        return Promise.resolve(resolve(ctx))
      },
      then(onF: (v: unknown) => unknown) {
        return Promise.resolve(resolve(ctx)).then(onF)
      },
    })
    return c
  }

  return {
    client: { from: (t: string) => chain(t) } as never,
    runInserts,
    systemMessages,
  }
}

const baseCtx = (
  client: never,
  over: Partial<Parameters<typeof handleHandoffRequest>[1]['currentRun']> = {},
) => ({
  supabase: client,
  roomId: 'room-1',
  sourceAgentId: 'agent-A',
  sourceMessageId: 'msg-1',
  currentRun: {
    id: 'run-A',
    round_index: 0,
    deliberation_depth: 0,
    deliberation_root_id: null,
    discussion_mode: 'independent' as const,
    ...over,
  },
})

const ev = (slug: string) => ({
  type: 'handoff_requested' as const,
  run_id: 'run-A',
  to_agent_slug: slug,
  reason: 'need a review',
})

test('successful hand-off creates exactly one targeted peer run under the guards', async () => {
  const fake = makeFake({
    members: [
      { agent_id: 'agent-A', slug: 'thinker', is_active: true },
      { agent_id: 'agent-B', slug: 'reviewer', is_active: true },
    ],
    rootAgentId: 'agent-A',
  })
  const res = await handleHandoffRequest(ev('reviewer'), baseCtx(fake.client))
  assert.equal(res.ok, true)
  assert.equal(fake.runInserts.length, 1)
  const row = fake.runInserts[0]!
  assert.equal(row.agent_id, 'agent-B')
  assert.equal(row.trigger_msg_id, 'msg-1')
  assert.equal(row.round_index, 1)
  assert.equal(row.deliberation_depth, 1)
  assert.equal(row.deliberation_root_id, 'run-A')
})

test('hand-off blocked when allow_agent_to_agent is false', async () => {
  const fake = makeFake({
    room: { allow_agent_to_agent: false, max_agent_rounds: 3, max_agent_hops: 6 },
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
  })
  const res = await handleHandoffRequest(ev('reviewer'), baseCtx(fake.client))
  assert.equal(res.ok, false)
  assert.equal(fake.runInserts.length, 0)
})

test('unknown target slug is rejected', async () => {
  const fake = makeFake({ members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }] })
  const res = await handleHandoffRequest(ev('ghost'), baseCtx(fake.client))
  assert.equal(res.ok, false)
  assert.equal(fake.runInserts.length, 0)
})

test('self hand-off is rejected (trivial cycle)', async () => {
  const fake = makeFake({ members: [{ agent_id: 'agent-A', slug: 'thinker', is_active: true }] })
  const res = await handleHandoffRequest(ev('thinker'), baseCtx(fake.client))
  assert.equal(res.ok, false)
  assert.equal(fake.runInserts.length, 0)
})

test('round cap terminates the chain with a system message', async () => {
  const fake = makeFake({
    room: { allow_agent_to_agent: true, max_agent_rounds: 3, max_agent_hops: 6 },
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
  })
  // round_index 2 → next would be 3 >= max_agent_rounds(3) → capped
  const res = await handleHandoffRequest(ev('reviewer'), baseCtx(fake.client, { round_index: 2 }))
  assert.equal(res.ok, false)
  assert.equal(fake.runInserts.length, 0)
  assert.ok(fake.systemMessages.some((m) => /round limit/i.test(m)))
})

test('hop cap terminates the chain with a system message', async () => {
  const fake = makeFake({
    room: { allow_agent_to_agent: true, max_agent_rounds: 100, max_agent_hops: 2 },
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
    rootAgentId: 'agent-Z',
  })
  // deliberation_depth 2 → next would be 3 > max_agent_hops(2) → capped
  const res = await handleHandoffRequest(
    ev('reviewer'),
    baseCtx(fake.client, {
      deliberation_depth: 2,
      round_index: 2,
      deliberation_root_id: 'run-root',
    }),
  )
  assert.equal(res.ok, false)
  assert.ok(fake.systemMessages.some((m) => /hop limit/i.test(m)))
})

test('CYCLE A→B→A is detected and blocked (hard gate: chains terminate)', async () => {
  // Chain root run-root is agent-A; a descendant run is agent-B. Now agent-B (the
  // current run) tries to hand back to agent-A → A already in the chain → cycle.
  const fake = makeFake({
    room: { allow_agent_to_agent: true, max_agent_rounds: 100, max_agent_hops: 100 },
    members: [
      { agent_id: 'agent-A', slug: 'thinker', is_active: true },
      { agent_id: 'agent-B', slug: 'reviewer', is_active: true },
    ],
    rootAgentId: 'agent-A',
    chainDescendants: ['agent-B'],
  })
  const ctx = {
    supabase: fake.client,
    roomId: 'room-1',
    sourceAgentId: 'agent-B',
    sourceMessageId: 'msg-2',
    currentRun: {
      id: 'run-B',
      round_index: 1,
      deliberation_depth: 1,
      deliberation_root_id: 'run-root',
      discussion_mode: 'independent' as const,
    },
  }
  const res = await handleHandoffRequest(ev('thinker'), ctx)
  assert.equal(res.ok, false)
  assert.equal((res as { reason: string }).reason, 'cycle')
  assert.equal(fake.runInserts.length, 0)
  assert.ok(fake.systemMessages.some((m) => /cycle/i.test(m)))
})

test('duplicate hand-off to the same peer at the same round is not double-created', async () => {
  const fake = makeFake({
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
    rootAgentId: 'agent-A',
    existingDup: true,
  })
  const res = await handleHandoffRequest(ev('reviewer'), baseCtx(fake.client))
  assert.equal(res.ok, false)
  assert.equal((res as { reason: string }).reason, 'duplicate')
  assert.equal(fake.runInserts.length, 0)
})

test('an invalid event is rejected and never throws', async () => {
  const fake = makeFake({})
  const res = await handleHandoffRequest(
    { type: 'handoff_requested', run_id: 'r' },
    baseCtx(fake.client),
  )
  assert.equal(res.ok, false)
})
