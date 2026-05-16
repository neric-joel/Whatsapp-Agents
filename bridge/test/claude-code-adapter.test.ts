import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ClaudeCodeAdapter } from '../src/adapters/claude-code-adapter.js'
import type { ContextPacketV1 } from '@agentroom/shared'

class TestClaudeCodeAdapter extends ClaudeCodeAdapter {
  stdin(packet: ContextPacketV1) {
    return this.buildStdin(packet)
  }

  parse(line: string) {
    return this.parseStdoutLine(line)
  }
}

const packet: ContextPacketV1 = {
  schema_version: 1,
  run_id: 'run-1',
  room: {
    id: 'room-1',
    name: 'Demo',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
  },
  agent: {
    id: 'agent-1',
    name: 'Claude Thinker',
    slug: 'claude-thinker',
    system_prompt: null,
    provider: 'claude_code',
  },
  trigger_message: {
    id: 'msg-2',
    content: 'Answer this now',
    sender_type: 'user',
    created_at: '2026-05-16T00:01:00.000Z',
  },
  recent_messages: [
    {
      id: 'msg-1',
      content: 'Older context',
      sender_type: 'user',
      sender_agent_id: null,
      created_at: '2026-05-16T00:00:00.000Z',
      metadata: {},
    },
    {
      id: 'msg-2',
      content: 'Answer this now',
      sender_type: 'user',
      sender_agent_id: null,
      created_at: '2026-05-16T00:01:00.000Z',
      metadata: {},
    },
  ],
  round_index: 1,
}

test('claude prompt labels prior turns as relevant recent context only', () => {
  const adapter = new TestClaudeCodeAdapter()
  const prompt = adapter.stdin(packet)

  assert.match(prompt, /Relevant recent context only\./)
  assert.match(prompt, /User: Older context/)
  assert.match(prompt, /CURRENT MESSAGE YOU MUST RESPOND TO:\nAnswer this now/)
})

test('extracts visible message content from claude result output', () => {
  const adapter = new TestClaudeCodeAdapter()
  const event = adapter.parse(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Hello from Claude Thinker!',
    stop_reason: 'end_turn',
  }))

  assert.deepEqual(event, {
    type: 'visible_message',
    run_id: '',
    content: 'Hello from Claude Thinker!',
  })
})
