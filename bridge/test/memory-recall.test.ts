import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MemoryEntry } from '@agentroom/shared'

import { applyMemoryBudget, recallMemory } from '../src/memory/recall.js'

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

test('recallMemory returns ranked agent entries from the RPC', async () => {
  const supabase = {
    rpc: (_fn: string, _args: unknown) =>
      Promise.resolve({ data: [entry('m1', 'the deadline is Friday')], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  } as never
  const memory = await recallMemory(supabase, {
    agentId: 'a1',
    roomId: 'r1',
    queryText: 'deadline',
  })
  assert.ok(memory)
  assert.equal(memory!.agent.length, 1)
  assert.equal(memory!.agent[0]!.content, 'the deadline is Friday')
  assert.equal(memory!.user, undefined)
})

test('recallMemory includes user profile only when consented', async () => {
  const makeClient = (consented: boolean) =>
    ({
      rpc: () => Promise.resolve({ data: [], error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { summary: 'likes brevity', details: {}, consented },
                error: null,
              }),
          }),
        }),
      }),
    }) as never

  const withConsent = await recallMemory(makeClient(true), {
    agentId: 'a1',
    roomId: 'r1',
    queryText: 'x',
    userId: 'u1',
  })
  assert.equal(withConsent?.user?.summary, 'likes brevity')

  const withoutConsent = await recallMemory(makeClient(false), {
    agentId: 'a1',
    roomId: 'r1',
    queryText: 'x',
    userId: 'u1',
  })
  // no agent rows + no consented profile → undefined
  assert.equal(withoutConsent, undefined)
})

test('recallMemory is resilient to RPC errors', async () => {
  const supabase = {
    rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  } as never
  const memory = await recallMemory(supabase, { agentId: 'a1', roomId: 'r1', queryText: 'x' })
  assert.equal(memory, undefined)
})
