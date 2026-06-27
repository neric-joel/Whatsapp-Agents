import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import type { MemoryEntry } from '@agentroom/shared'

import { applyMemoryBudget, recallMemory } from '../src/memory/recall.js'
import { freshTestDb, seedAgent, seedRoom, type TestDb } from './helpers/test-db.js'

function entry(id: string, content: string, title: string | null = null): MemoryEntry {
  return {
    id,
    agent_id: 'a1',
    room_id: 'r1',
    scope: 'room',
    kind: 'fact',
    title,
    content,
    source_message_id: null,
    created_by_user_id: null,
    confidence: 0.5,
    pinned: false,
    is_active: true,
    injection_flagged: false,
    created_at: '2026-05-31T00:00:00Z',
    updated_at: '2026-05-31T00:00:00Z',
  }
}

// --- pure budget helper (no DB) ---------------------------------------------

test('applyMemoryBudget caps by entry count', () => {
  const rows = Array.from({ length: 10 }, (_, i) => entry(`m${i}`, 'short'))
  assert.equal(applyMemoryBudget(rows, 3, 10_000).length, 3)
})

test('applyMemoryBudget caps by char budget', () => {
  const rows = [
    entry('a', 'x'.repeat(100)),
    entry('b', 'y'.repeat(100)),
    entry('c', 'z'.repeat(100)),
  ]
  // budget 150 → first fits (100), second would push to 200 > 150 → stop at 1
  assert.equal(applyMemoryBudget(rows, 8, 150).length, 1)
})

test('applyMemoryBudget always allows at least one entry over budget', () => {
  const rows = [entry('a', 'x'.repeat(9999))]
  assert.equal(applyMemoryBudget(rows, 8, 100).length, 1)
})

test('applyMemoryBudget returns [] when caps are zero', () => {
  const rows = [entry('a', 'x')]
  assert.equal(applyMemoryBudget(rows, 0, 100).length, 0)
  assert.equal(applyMemoryBudget(rows, 8, 0).length, 0)
})

// --- recallMemory against the real local SQLite layer ------------------------

let h: TestDb

beforeEach(() => {
  h = freshTestDb()
  // The budget envs default to 8 entries / 4000 chars; make sure no prior test
  // leaked an override that would skew the recall budget assertions.
  delete process.env['AGENTROOM_MEMORY_MAX_ENTRIES']
  delete process.env['AGENTROOM_MEMORY_MAX_CHARS']
})

afterEach(() => {
  h.cleanup()
  delete process.env['AGENTROOM_MEMORY_MAX_ENTRIES']
  delete process.env['AGENTROOM_MEMORY_MAX_CHARS']
})

/** Insert an agent_memory row (active, room-scoped fact by default). Returns id. */
function seedMemory(o: Record<string, unknown> = {}): string {
  const id = (o['id'] as string) ?? `mem-${Math.random().toString(36).slice(2)}`
  const row: Record<string, unknown> = {
    id,
    agent_id: 'a1',
    room_id: 'r1',
    scope: 'room',
    kind: 'fact',
    title: null,
    content: 'note',
    source_message_id: null,
    created_by_user_id: null,
    confidence: 0.5,
    pinned: 0,
    is_active: 1,
    injection_flagged: 0,
    created_at: '2026-05-31T00:00:00Z',
    updated_at: '2026-05-31T00:00:00Z',
    ...o,
  }
  const cols = Object.keys(row)
  h.db
    .prepare(`INSERT INTO agent_memory (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]))
  return id
}

test('recallMemory returns ranked agent entries from the DB', async () => {
  seedRoom(h.db, { id: 'r1' })
  seedAgent(h.db, { id: 'a1' })
  seedMemory({ id: 'm1', content: 'the deadline is Friday' })

  const memory = await recallMemory({
    agentId: 'a1',
    roomId: 'r1',
    queryText: 'deadline',
  })
  assert.ok(memory)
  assert.equal(memory!.agent.length, 1)
  assert.equal(memory!.agent[0]!.content, 'the deadline is Friday')
  assert.equal(memory!.user, undefined)
})

test('recallMemory ranks pinned, then confidence, then created_at (all DESC)', async () => {
  seedRoom(h.db, { id: 'r1' })
  seedAgent(h.db, { id: 'a1' })
  // No query → ranking falls to pinned DESC, confidence DESC, created_at DESC.
  // Seed in a deliberately wrong order so only the sort can produce the result.
  seedMemory({ id: 'low-conf-old', content: 'c', confidence: 0.1, pinned: 0, created_at: '2026-01-01T00:00:00Z' })
  seedMemory({ id: 'high-conf', content: 'b', confidence: 0.9, pinned: 0, created_at: '2026-02-01T00:00:00Z' })
  seedMemory({ id: 'mid-conf-new', content: 'c', confidence: 0.1, pinned: 0, created_at: '2026-03-01T00:00:00Z' })
  seedMemory({ id: 'pinned', content: 'a', confidence: 0.0, pinned: 1, created_at: '2025-01-01T00:00:00Z' })

  const memory = await recallMemory({ agentId: 'a1', roomId: 'r1', queryText: '' })
  assert.ok(memory)
  const ids = memory!.agent.map((e) => e.id)
  // pinned first (despite lowest confidence + oldest), then highest confidence,
  // then among equal-confidence rows the newer created_at wins.
  assert.deepEqual(ids, ['pinned', 'high-conf', 'mid-conf-new', 'low-conf-old'])
})

test('recallMemory enforces the entry cap (AGENTROOM_MEMORY_MAX_ENTRIES)', async () => {
  process.env['AGENTROOM_MEMORY_MAX_ENTRIES'] = '3'
  seedRoom(h.db, { id: 'r1' })
  seedAgent(h.db, { id: 'a1' })
  for (let i = 0; i < 10; i++) {
    seedMemory({ id: `m${i}`, content: `note ${i}`, confidence: i / 10 })
  }
  const memory = await recallMemory({ agentId: 'a1', roomId: 'r1', queryText: '' })
  assert.ok(memory)
  assert.equal(memory!.agent.length, 3)
})

test('recallMemory enforces the char budget (AGENTROOM_MEMORY_MAX_CHARS)', async () => {
  process.env['AGENTROOM_MEMORY_MAX_CHARS'] = '150'
  seedRoom(h.db, { id: 'r1' })
  seedAgent(h.db, { id: 'a1' })
  // Three 100-char rows; budget 150 admits only the first (second → 200 > 150).
  // Use descending confidence so DB ranking is deterministic.
  seedMemory({ id: 'x', content: 'x'.repeat(100), confidence: 0.9 })
  seedMemory({ id: 'y', content: 'y'.repeat(100), confidence: 0.5 })
  seedMemory({ id: 'z', content: 'z'.repeat(100), confidence: 0.1 })
  const memory = await recallMemory({ agentId: 'a1', roomId: 'r1', queryText: '' })
  assert.ok(memory)
  assert.equal(memory!.agent.length, 1)
  assert.equal(memory!.agent[0]!.id, 'x')
})

test('recallMemory includes user profile only when consented', async () => {
  seedRoom(h.db, { id: 'r1' })
  seedAgent(h.db, { id: 'a1' })

  // Consented profile → surfaced. (No agent rows seeded; the profile alone is enough.)
  h.db
    .prepare(
      `INSERT INTO user_profile (id, user_id, summary, details, consented)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run('p1', 'u1', 'likes brevity', '{}', 1)

  const withConsent = await recallMemory({
    agentId: 'a1',
    roomId: 'r1',
    queryText: 'x',
    userId: 'u1',
  })
  assert.equal(withConsent?.user?.summary, 'likes brevity')
})

test('recallMemory withholds an unconsented profile (no agent rows → undefined)', async () => {
  seedRoom(h.db, { id: 'r1' })
  seedAgent(h.db, { id: 'a1' })

  // Profile present but consented = 0 → must NOT be surfaced.
  h.db
    .prepare(
      `INSERT INTO user_profile (id, user_id, summary, details, consented)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run('p1', 'u1', 'likes brevity', '{}', 0)

  const withoutConsent = await recallMemory({
    agentId: 'a1',
    roomId: 'r1',
    queryText: 'x',
    userId: 'u1',
  })
  // no agent rows + no consented profile → undefined
  assert.equal(withoutConsent, undefined)
})

test('recallMemory is resilient to DB errors', async () => {
  seedRoom(h.db, { id: 'r1' })
  seedAgent(h.db, { id: 'a1' })
  // Force the recall query to throw by removing the table it reads. The source
  // wraps recall in try/catch and must return undefined rather than break the run.
  h.db.exec('DROP TABLE agent_memory')
  const memory = await recallMemory({ agentId: 'a1', roomId: 'r1', queryText: 'x' })
  assert.equal(memory, undefined)
})
