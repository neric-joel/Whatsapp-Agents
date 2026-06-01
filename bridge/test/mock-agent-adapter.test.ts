import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ContextPacketV1 } from '@agentroom/shared'

import { MockAgentAdapter } from '../src/adapters/mock-agent-adapter.js'

const packet: ContextPacketV1 = {
  schema_version: 1,
  run_id: 'run-1',
  room: {
    id: 'room-1',
    name: 'Demo',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
  },
  agent: {
    id: 'agent-reviewer',
    name: 'Reviewer',
    slug: 'reviewer',
    system_prompt: null,
    provider: 'mock',
  },
  trigger_message: {
    id: 'msg-current',
    content: 'Current evaluation prompt',
    sender_type: 'user',
    created_at: '2026-05-16T00:00:00.000Z',
  },
  recent_messages: [
    {
      id: 'msg-old',
      content: 'Old user prompt',
      sender_type: 'user',
      sender_agent_id: null,
      created_at: '2026-05-15T00:00:00.000Z',
      metadata: {},
    },
    {
      id: 'msg-current',
      content: 'Current evaluation prompt',
      sender_type: 'user',
      sender_agent_id: null,
      created_at: '2026-05-16T00:00:00.000Z',
      metadata: {},
    },
  ],
  round_index: 0,
  discussion_mode: 'independent',
  deliberation_depth: 0,
  deliberation_root_id: null,
}

test('mock adapter responds to the trigger message instead of older history', async () => {
  const adapter = new MockAgentAdapter()
  const events = []

  for await (const event of adapter.run(packet, new AbortController().signal)) {
    events.push(event)
  }

  const finalEvent = events.find((event) => event.type === 'final_response')
  assert.equal(finalEvent?.type, 'final_response')
  assert.match(finalEvent.response.content, /Current evaluation prompt/)
  assert.doesNotMatch(finalEvent.response.content, /Old user prompt/)
})
