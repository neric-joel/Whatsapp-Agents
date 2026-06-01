import assert from 'node:assert/strict'
import { test } from 'node:test'

import { maybeScheduleDiscussionContinuation } from '../src/lib/discussion-orchestrator.js'

// ── Minimal Supabase mock tailored to the exact queries the orchestrator makes ──
// from('agent_runs').select().eq().eq()                         -> awaited  -> cfg.runs
// from('messages').select('id').eq().eq().contains().limit()    -> challenge / existing checks
// from('messages').select('content,...').eq()*.contains().order().limit() -> plan reply
// from('room_members').select().eq()*4                          -> awaited  -> memberRows
// from('messages').insert().select('id').single()               -> new message id
// from('agent_runs').insert()                                   -> awaited  -> records rows
function makeSupabase(cfg) {
  const inserted = { messages: [], agent_runs: [] }

  function builder(table) {
    const ops = []
    const decide = () => {
      if (table === 'agent_runs') return { data: cfg.runs ?? [], error: null }
      if (table === 'room_members') return { data: cfg.memberRows ?? [], error: null }
      if (table === 'messages') {
        const containsArg = ops.find((o) => o[0] === 'contains')?.[1]?.[1]?.discussion ?? {}
        if (containsArg.challenge === true)
          return { data: cfg.challengePresent ? [{ id: 'c' }] : [], error: null }
        if (containsArg.phase)
          return { data: cfg.existingNextPhase ? [{ id: 'e' }] : [], error: null }
        const sel = ops.find((o) => o[0] === 'select')?.[1]?.[0] ?? ''
        if (sel.includes('content')) return { data: cfg.planReply ? [cfg.planReply] : [], error: null }
        return { data: [], error: null }
      }
      return { data: [], error: null }
    }
    const b = {
      select(...a) {
        ops.push(['select', a])
        return b
      },
      eq(...a) {
        ops.push(['eq', a])
        return b
      },
      contains(...a) {
        ops.push(['contains', a])
        return b
      },
      order(...a) {
        ops.push(['order', a])
        return b
      },
      limit() {
        return Promise.resolve(decide())
      },
      single() {
        return Promise.resolve(decide())
      },
      then(resolve) {
        return Promise.resolve(resolve(decide()))
      },
      insert(rows) {
        const ib = {
          select() {
            return ib
          },
          single() {
            const id = `msg-${inserted.messages.length + 1}`
            inserted.messages.push(rows)
            return Promise.resolve({ data: { id }, error: null })
          },
          then(resolve) {
            inserted.agent_runs.push(...(Array.isArray(rows) ? rows : [rows]))
            return Promise.resolve(resolve({ data: null, error: null }))
          },
        }
        return ib
      },
    }
    return b
  }

  return { from: (t) => builder(t), _inserted: inserted }
}

const member = (slug, id) => ({
  agent_id: id,
  agents: { id, name: slug, slug, provider: 'mock', capabilities: null, is_active: true },
})
const MEMBERS = [member('alpha', 'a'), member('bravo', 'b'), member('charlie', 'c')]

const discMeta = (phase, command = 'discuss', extra = {}) => ({
  discussion: {
    enabled: true,
    command,
    phase,
    original_message_id: 'root',
    original_prompt: 'Design a thing',
    coordinator_agent_id: 'a',
    ...extra,
  },
})

test('plan→execute: parses the plan reply into assignments and fans to all agents', async () => {
  const sb = makeSupabase({
    runs: [{ id: 'r1', status: 'completed' }],
    memberRows: MEMBERS,
    challengePresent: false,
    existingNextPhase: false,
    planReply: { content: '@alpha: design API\n@bravo: implement\n@charlie: tests', sender_agent_id: 'a' },
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan-msg', content: '', metadata: discMeta('plan') },
  })
  assert.equal(sb._inserted.messages.length, 1)
  const msg = sb._inserted.messages[0]
  assert.equal(msg.metadata.discussion.phase, 'execute')
  assert.equal(msg.metadata.discussion.assignments.length, 3)
  assert.equal(sb._inserted.agent_runs.length, 3) // all active agents execute
  // deliberation_depth carried forward as the phase number (NOT reset to 0); root stays null
  // (the FK references agent_runs(id); handoffs self-root)
  assert.equal(sb._inserted.agent_runs[0].deliberation_root_id, null)
  assert.equal(sb._inserted.agent_runs[0].round_index, 1)
  assert.equal(sb._inserted.agent_runs[0].deliberation_depth, 2) // execute is stage 2
})

test('plan→execute: malformed plan falls back to round-robin (never stalls)', async () => {
  const sb = makeSupabase({
    runs: [{ id: 'r1', status: 'completed' }],
    memberRows: MEMBERS,
    planReply: { content: 'no assignments here at all', sender_agent_id: 'a' },
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan-msg', content: '', metadata: discMeta('plan') },
  })
  assert.equal(sb._inserted.messages[0].metadata.discussion.assignments.length, 3)
  assert.equal(sb._inserted.agent_runs.length, 3)
})

test('integrate→dissent when no challenge (anti-sycophancy)', async () => {
  const sb = makeSupabase({
    runs: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }],
    memberRows: MEMBERS,
    challengePresent: false,
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 2,
    triggerMessage: { id: 'int-msg', content: '', metadata: discMeta('integrate') },
  })
  assert.equal(sb._inserted.messages[0].metadata.discussion.phase, 'dissent')
  assert.equal(sb._inserted.agent_runs.length, 3) // dissent fans to all
})

test('integrate→converge when a challenge exists; converge is coordinator-only', async () => {
  const sb = makeSupabase({
    runs: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }],
    memberRows: MEMBERS,
    challengePresent: true,
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 2,
    triggerMessage: { id: 'int-msg', content: '', metadata: discMeta('integrate') },
  })
  assert.equal(sb._inserted.messages[0].metadata.discussion.phase, 'converge')
  assert.equal(sb._inserted.agent_runs.length, 1) // only the coordinator converges
  assert.equal(sb._inserted.agent_runs[0].agent_id, 'a')
})

test('converge is terminal — schedules nothing further', async () => {
  const sb = makeSupabase({ runs: [{ status: 'completed' }], memberRows: MEMBERS })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 3,
    triggerMessage: { id: 'conv-msg', content: '', metadata: discMeta('converge') },
  })
  assert.equal(sb._inserted.messages.length, 0)
  assert.equal(sb._inserted.agent_runs.length, 0)
})

test('does not advance when the phase produced no completed run (all failed)', async () => {
  const sb = makeSupabase({
    runs: [{ status: 'failed' }, { status: 'failed' }],
    memberRows: MEMBERS,
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 1,
    triggerMessage: { id: 'exec-msg', content: '', metadata: discMeta('execute') },
  })
  assert.equal(sb._inserted.messages.length, 0)
})

test('idempotency: does not schedule a phase that already exists', async () => {
  const sb = makeSupabase({
    runs: [{ status: 'completed' }],
    memberRows: MEMBERS,
    existingNextPhase: true,
    planReply: { content: '@alpha: a', sender_agent_id: 'a' },
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan-msg', content: '', metadata: discMeta('plan') },
  })
  assert.equal(sb._inserted.messages.length, 0)
})

test('debate: assign→argue fans to all with distinct positions; rebut→adjudicate is coordinator', async () => {
  const sb = makeSupabase({
    runs: [{ status: 'completed' }],
    memberRows: MEMBERS,
    planReply: { content: 'no parse', sender_agent_id: 'a' },
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 0,
    triggerMessage: { id: 'assign-msg', content: '', metadata: discMeta('assign', 'debate') },
  })
  assert.equal(sb._inserted.messages[0].metadata.discussion.phase, 'argue')
  assert.equal(sb._inserted.agent_runs.length, 3)
  // debate fallback gives distinct positions
  const positions = sb._inserted.messages[0].metadata.discussion.assignments.map((a) => a.position)
  assert.deepEqual([...new Set(positions)].sort(), ['against', 'alternative', 'for'])
})

test('caps fan-out to COLLAB_MAX_AGENTS in a large room (keeps coordinator)', async () => {
  const big = ['a', 'b', 'c', 'd', 'e'].map((s) => member(s, s))
  const sb = makeSupabase({
    runs: [{ status: 'completed' }],
    memberRows: big,
    planReply: { content: 'no parse', sender_agent_id: 'a' },
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 0,
    triggerMessage: { id: 'plan', content: '', metadata: discMeta('plan') },
  })
  // 5 active agents, but execute fans to at most COLLAB_MAX_AGENTS (3)
  assert.equal(sb._inserted.agent_runs.length, 3)
  // the coordinator (a) is retained
  assert.ok(sb._inserted.agent_runs.some((r) => r.agent_id === 'a'))
})

test('stamps anti_sycophancy when converging from dissent with no challenge', async () => {
  const sb = makeSupabase({
    runs: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }],
    memberRows: MEMBERS,
    challengePresent: false,
  })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 3,
    triggerMessage: { id: 'dissent-msg', content: '', metadata: discMeta('dissent') },
  })
  assert.equal(sb._inserted.messages[0].metadata.discussion.phase, 'converge')
  assert.equal(
    sb._inserted.messages[0].metadata.discussion.anti_sycophancy,
    'no_challenge_after_dissent',
  )
})

test('not a discussion → no-op', async () => {
  const sb = makeSupabase({ runs: [{ status: 'completed' }] })
  await maybeScheduleDiscussionContinuation({
    supabase: sb,
    roomId: 'room',
    currentRoundIndex: 0,
    triggerMessage: { id: 'm', content: '', metadata: {} },
  })
  assert.equal(sb._inserted.messages.length, 0)
})
