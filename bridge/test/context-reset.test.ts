import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import { buildContextPacket } from '../src/context/build-context-packet.js'
import { freshTestDb, seedMessage, seedRoom, type TestDb } from './helpers/test-db.js'

// The `/reset` watermark (rooms.context_reset_at) gates the agent's rolling
// context window: agents only see messages at/after it, while the transcript
// stays intact in the DB. The old test mocked Supabase and counted `.gte()`
// calls; now we seed real rows around the watermark and assert on the actual
// recent_messages the packet returns.

const agentInfo = {
  id: 'agent-1',
  name: 'Helper',
  slug: 'helper',
  system_prompt: null,
  provider: 'mock',
}

// The ported buildContextPacket reads run.round_index / discussion_mode /
// deliberation_* into the packet, so provide the full shape.
const run = {
  id: 'run-1',
  room_id: 'room-1',
  round_index: 0,
  discussion_mode: 'independent' as const,
  deliberation_depth: 0,
  deliberation_root_id: null,
}

// Trigger fires at 12:00 — it is the upper bound (created_at <= trigger) of the
// non-discussion window.
const triggerMsg = {
  id: 'msg-trigger',
  content: 'hello',
  sender_type: 'user',
  sender_user_id: 'user-1',
  created_at: '2026-05-31T12:00:00.000Z',
}

let h: TestDb
beforeEach(() => {
  h = freshTestDb()
})
afterEach(() => {
  h.cleanup()
})

test('applies the reset watermark as a lower bound on the context window', async () => {
  const watermark = '2026-05-31T11:00:00.000Z'
  seedRoom(h.db, {
    id: 'room-1',
    name: 'Demo',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
    context_reset_at: watermark,
  })

  // Two messages straddle the watermark; both precede the trigger ceiling.
  seedMessage(h.db, 'room-1', {
    id: 'msg-before',
    content: 'before reset',
    created_at: '2026-05-31T10:00:00.000Z', // < watermark → excluded
  })
  seedMessage(h.db, 'room-1', {
    id: 'msg-after',
    content: 'after reset',
    created_at: '2026-05-31T11:30:00.000Z', // >= watermark, <= trigger → included
  })

  const packet = await buildContextPacket({ run, agentInfo, triggerMsg })

  const ids = packet.recent_messages.map((m) => m.id)
  assert.ok(
    !ids.includes('msg-before'),
    'message before the reset watermark must be excluded from the context window',
  )
  assert.ok(
    ids.includes('msg-after'),
    'message at/after the reset watermark must remain in the context window',
  )
  assert.deepEqual(ids, ['msg-after'], 'only the post-watermark message is in the window')
})

test('no watermark → no lower bound (full window)', async () => {
  seedRoom(h.db, {
    id: 'room-1',
    name: 'Demo',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
    context_reset_at: null,
  })

  // Same two messages — with no watermark the full window (everything up to the
  // trigger ceiling) is returned, including the older one.
  seedMessage(h.db, 'room-1', {
    id: 'msg-before',
    content: 'older message',
    created_at: '2026-05-31T10:00:00.000Z',
  })
  seedMessage(h.db, 'room-1', {
    id: 'msg-after',
    content: 'newer message',
    created_at: '2026-05-31T11:30:00.000Z',
  })

  const packet = await buildContextPacket({ run, agentInfo, triggerMsg })

  const ids = packet.recent_messages.map((m) => m.id)
  assert.ok(
    ids.includes('msg-before') && ids.includes('msg-after'),
    'no reset → no lower bound: every message up to the trigger is in the window',
  )
  // Chronological order (oldest first), matching the source reverse() of the DESC query.
  assert.deepEqual(ids, ['msg-before', 'msg-after'], 'full window in chronological order')
})
