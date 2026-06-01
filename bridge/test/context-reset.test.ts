import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildContextPacket } from '../src/context/build-context-packet.js'

// Records every `.gte('created_at', …)` lower-bound applied to any query so we
// can prove the `/reset` watermark (rooms.context_reset_at) gates the agent's
// rolling context window — while leaving messages in the DB untouched.
function makeMock(room: Record<string, unknown>) {
  const gteCalls: Array<{ column: string; value: unknown }> = []

  function builder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      lte: () => b,
      in: () => b,
      or: () => b,
      order: () => b,
      gte: (column: string, value: unknown) => {
        gteCalls.push({ column, value })
        return b
      },
      limit: () => Promise.resolve({ data: [], error: null }),
      single: () => Promise.resolve({ data: table === 'rooms' ? room : null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      // Awaiting the builder directly (no terminal) resolves to an empty set.
      then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
        resolve({ data: [], error: null }),
    }
    return b
  }

  const supabase = {
    from: (table: string) => builder(table),
    rpc: () => Promise.resolve({ data: [], error: null }),
  }
  return { supabase, gteCalls }
}

const agentInfo = {
  id: 'agent-1',
  name: 'Helper',
  slug: 'helper',
  system_prompt: null,
  provider: 'mock',
}

const run = { id: 'run-1', room_id: 'room-1' }
const triggerMsg = {
  id: 'msg-1',
  content: 'hello',
  sender_type: 'user',
  sender_user_id: 'user-1',
  created_at: '2026-05-31T12:00:00.000Z',
}

test('applies the reset watermark as a lower bound on the context window', async () => {
  const watermark = '2026-05-31T11:00:00.000Z'
  const { supabase, gteCalls } = makeMock({
    id: 'room-1',
    name: 'Demo',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
    context_reset_at: watermark,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await buildContextPacket({ supabase: supabase as any, run, agentInfo, triggerMsg } as any)

  assert.ok(
    gteCalls.some((c) => c.column === 'created_at' && c.value === watermark),
    'expected a .gte(created_at, watermark) lower bound on the messages query',
  )
})

test('no watermark → no lower bound (full window)', async () => {
  const { supabase, gteCalls } = makeMock({
    id: 'room-1',
    name: 'Demo',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
    context_reset_at: null,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await buildContextPacket({ supabase: supabase as any, run, agentInfo, triggerMsg } as any)

  assert.equal(
    gteCalls.filter((c) => c.column === 'created_at').length,
    0,
    'no reset → no created_at lower bound',
  )
})
