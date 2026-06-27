import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { handleHandoffRequest } from '../src/agents/handoff.js'
import {
  freshTestDb,
  seedAgent,
  seedMember,
  seedRoom,
  seedRun,
  type TestDb,
} from './helpers/test-db.js'

let h: TestDb

beforeEach(() => {
  h = freshTestDb()
})

afterEach(() => {
  h.cleanup()
})

interface SeedOpts {
  /** Room guards. Pass null to skip seeding the room entirely (room_missing). */
  room?: { allow_agent_to_agent: boolean; max_agent_rounds: number; max_agent_hops: number } | null
  /** Agent members of the room (each seeded as an active/inactive agent + member). */
  members?: Array<{ agent_id: string; slug: string; is_active: boolean }>
}

/**
 * Seed the rooms + agents + room_members the source reads. Mirrors the old fake's
 * "room" and "members" inputs, but against the real SQLite layer.
 */
function seedWorld(opts: SeedOpts): void {
  const room =
    opts.room === undefined
      ? { allow_agent_to_agent: true, max_agent_rounds: 3, max_agent_hops: 6 }
      : opts.room
  if (room) {
    seedRoom(h.db, {
      id: 'room-1',
      allow_agent_to_agent: room.allow_agent_to_agent ? 1 : 0,
      max_agent_rounds: room.max_agent_rounds,
      max_agent_hops: room.max_agent_hops,
    })
  }
  for (const m of opts.members ?? []) {
    seedAgent(h.db, { id: m.agent_id, slug: m.slug, is_active: m.is_active ? 1 : 0 })
    seedMember(h.db, 'room-1', {
      agent_id: m.agent_id,
      member_type: 'agent',
      reply_enabled: 1,
      muted: 0,
    })
  }
}

/**
 * Seed the chain root run (id = rootId, agent_id = rootAgentId) plus any
 * descendant runs (deliberation_root_id = rootId). Used by the cycle / success
 * tests where the source reads the chain to detect repeat participants.
 */
function seedChain(rootId: string, rootAgentId: string | null, descendants: string[] = []): void {
  // agent_runs.agent_id has a FK to agents — make sure every chain agent exists
  // (some are already room members; INSERT OR IGNORE keeps this idempotent).
  const ensureAgent = (agentId: string) => {
    h.db
      .prepare(
        `INSERT OR IGNORE INTO agents (id, name, slug, provider, adapter_type)
         VALUES (?, ?, ?, 'mock', 'mock')`,
      )
      .run(agentId, `Agent ${agentId}`, `slug_${agentId}`)
  }
  if (rootAgentId) {
    ensureAgent(rootAgentId)
    // The root run itself: its own deliberation_root_id is null (it is the root).
    seedRun(h.db, 'room-1', rootAgentId, { id: rootId, deliberation_root_id: null })
  }
  let i = 0
  for (const agentId of descendants) {
    ensureAgent(agentId)
    seedRun(h.db, 'room-1', agentId, {
      id: `${rootId}-desc-${i++}`,
      deliberation_root_id: rootId,
    })
  }
}

/** Read the targeted peer agent_runs that the source created (excludes seeded chain rows). */
function targetedRuns(): Array<Record<string, unknown>> {
  return h.db
    .prepare(`SELECT * FROM agent_runs WHERE trigger_msg_id = ? ORDER BY created_at`)
    .all('msg-1') as Array<Record<string, unknown>>
}

/** Read all system messages the source posted to the room. */
function systemMessages(): string[] {
  return (
    h.db
      .prepare(`SELECT content FROM messages WHERE room_id = ? AND sender_type = 'system'`)
      .all('room-1') as Array<{ content: string }>
  ).map((r) => r.content)
}

const baseCtx = (over: Partial<Parameters<typeof handleHandoffRequest>[1]['currentRun']> = {}) => ({
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
  seedWorld({
    members: [
      { agent_id: 'agent-A', slug: 'thinker', is_active: true },
      { agent_id: 'agent-B', slug: 'reviewer', is_active: true },
    ],
  })
  // currentRun.id 'run-A' is the chain root, owned by agent-A.
  seedChain('run-A', 'agent-A')

  const res = await handleHandoffRequest(ev('reviewer'), baseCtx())
  assert.equal(res.ok, true)

  const runs = targetedRuns()
  assert.equal(runs.length, 1)
  const row = runs[0]!
  assert.equal(row.agent_id, 'agent-B')
  assert.equal(row.trigger_msg_id, 'msg-1')
  assert.equal(row.round_index, 1)
  assert.equal(row.deliberation_depth, 1)
  assert.equal(row.deliberation_root_id, 'run-A')
  assert.equal(row.status, 'queued')
})

test('hand-off blocked when allow_agent_to_agent is false', async () => {
  seedWorld({
    room: { allow_agent_to_agent: false, max_agent_rounds: 3, max_agent_hops: 6 },
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
  })
  const res = await handleHandoffRequest(ev('reviewer'), baseCtx())
  assert.equal(res.ok, false)
  assert.equal(targetedRuns().length, 0)
})

test('unknown target slug is rejected', async () => {
  seedWorld({ members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }] })
  const res = await handleHandoffRequest(ev('ghost'), baseCtx())
  assert.equal(res.ok, false)
  assert.equal(targetedRuns().length, 0)
})

test('self hand-off is rejected (trivial cycle)', async () => {
  seedWorld({ members: [{ agent_id: 'agent-A', slug: 'thinker', is_active: true }] })
  const res = await handleHandoffRequest(ev('thinker'), baseCtx())
  assert.equal(res.ok, false)
  assert.equal(targetedRuns().length, 0)
})

test('round cap terminates the chain with a system message', async () => {
  seedWorld({
    room: { allow_agent_to_agent: true, max_agent_rounds: 3, max_agent_hops: 6 },
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
  })
  // round_index 2 → next would be 3 >= max_agent_rounds(3) → capped
  const res = await handleHandoffRequest(ev('reviewer'), baseCtx({ round_index: 2 }))
  assert.equal(res.ok, false)
  assert.equal(targetedRuns().length, 0)
  assert.ok(systemMessages().some((m) => /round limit/i.test(m)))
})

test('hop cap terminates the chain with a system message', async () => {
  seedWorld({
    room: { allow_agent_to_agent: true, max_agent_rounds: 100, max_agent_hops: 2 },
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
  })
  // deliberation_depth 2 → next would be 3 > max_agent_hops(2) → capped
  const res = await handleHandoffRequest(
    ev('reviewer'),
    baseCtx({
      deliberation_depth: 2,
      round_index: 2,
      deliberation_root_id: 'run-root',
    }),
  )
  assert.equal(res.ok, false)
  assert.equal(targetedRuns().length, 0)
  assert.ok(systemMessages().some((m) => /hop limit/i.test(m)))
})

test('CYCLE A→B→A is detected and blocked (hard gate: chains terminate)', async () => {
  // Chain root run-root is agent-A; a descendant run is agent-B. Now agent-B (the
  // current run) tries to hand back to agent-A → A already in the chain → cycle.
  seedWorld({
    room: { allow_agent_to_agent: true, max_agent_rounds: 100, max_agent_hops: 100 },
    members: [
      { agent_id: 'agent-A', slug: 'thinker', is_active: true },
      { agent_id: 'agent-B', slug: 'reviewer', is_active: true },
    ],
  })
  // root run-root owned by agent-A, with a descendant run owned by agent-B.
  seedChain('run-root', 'agent-A', ['agent-B'])

  const ctx = {
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
  // No targeted peer run created for this hand-off message.
  assert.equal(
    (h.db.prepare(`SELECT * FROM agent_runs WHERE trigger_msg_id = ?`).all('msg-2') as unknown[])
      .length,
    0,
  )
  assert.ok(systemMessages().some((m) => /cycle/i.test(m)))
})

test('duplicate hand-off to the same peer at the same round is not double-created', async () => {
  seedWorld({
    members: [{ agent_id: 'agent-B', slug: 'reviewer', is_active: true }],
  })
  // chain root run-A owned by agent-A (source) so the cycle check passes for agent-B.
  seedChain('run-A', 'agent-A')
  // An existing run already targets agent-B for this trigger message at the next round (1).
  seedRun(h.db, 'room-1', 'agent-B', {
    id: 'existing-dup',
    trigger_msg_id: 'msg-1',
    round_index: 1,
  })

  const res = await handleHandoffRequest(ev('reviewer'), baseCtx())
  assert.equal(res.ok, false)
  assert.equal((res as { reason: string }).reason, 'duplicate')
  // Still exactly the one pre-existing run — no second one created.
  assert.equal(targetedRuns().length, 1)
  assert.equal(targetedRuns()[0]!.id, 'existing-dup')
})

test('an invalid event is rejected and never throws', async () => {
  seedWorld({})
  const res = await handleHandoffRequest({ type: 'handoff_requested', run_id: 'r' }, baseCtx())
  assert.equal(res.ok, false)
})
