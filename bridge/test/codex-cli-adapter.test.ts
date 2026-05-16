import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CodexCliAdapter } from '../src/adapters/codex-cli-adapter.js'
import { SubprocessAdapter } from '../src/adapters/subprocess-adapter.js'
import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

const packet: ContextPacketV1 = {
  schema_version: 1,
  run_id: 'run-1',
  room: {
    id: 'room-1',
    name: 'Dev Room',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
  },
  agent: {
    id: 'agent-1',
    name: 'CodexAgent',
    slug: 'codex-agent',
    system_prompt: null,
    provider: 'codex_cli',
  },
  trigger_message: {
    id: 'msg-2',
    content: 'Please fix this',
    sender_type: 'user',
    created_at: '2026-05-15T00:00:00.000Z',
  },
  recent_messages: [
    {
      id: 'msg-1',
      content: 'Previous reply',
      sender_type: 'agent',
      sender_agent_id: 'agent-2',
      created_at: '2026-05-15T00:00:00.000Z',
      metadata: {},
    },
    {
      id: 'msg-2',
      content: 'Please fix this',
      sender_type: 'user',
      sender_agent_id: null,
      created_at: '2026-05-15T00:01:00.000Z',
      metadata: {},
    },
  ],
  round_index: 1,
}

class TestSubprocessAdapter extends SubprocessAdapter {
  readonly name = 'test'

  protected resolveCommand(): string { return 'node' }
  protected buildArgs(_packet: ContextPacketV1): string[] { return [] }
  protected envVarName(): string { return 'TEST_BIN' }

  stdin(packet: ContextPacketV1): string {
    return this.buildStdin(packet)
  }

  parse(line: string): AgentEvent | null {
    return this.parseStdoutLine(line)
  }
}

class TestCodexCliAdapter extends CodexCliAdapter {
  args(packet: ContextPacketV1): string[] {
    return this.buildArgs(packet)
  }

  stdin(packet: ContextPacketV1): string {
    return this.buildStdin(packet)
  }

  parse(line: string): AgentEvent | null {
    return this.parseStdoutLine(line)
  }
}

test('subprocess adapter defaults stdin to the serialized packet', () => {
  const adapter = new TestSubprocessAdapter()

  assert.equal(adapter.stdin(packet), JSON.stringify(packet))
})

test('subprocess adapter parses AgentResponseV1 stdout lines', () => {
  const adapter = new TestSubprocessAdapter()

  assert.deepEqual(adapter.parse(JSON.stringify({
    schema_version: 1,
    run_id: 'run-1',
    content: 'hello',
    content_type: 'text',
  })), {
    type: 'final_response',
    run_id: 'run-1',
    response: {
      schema_version: 1,
      run_id: 'run-1',
      content: 'hello',
      content_type: 'text',
    },
  })
})

test('codex adapter invokes codex exec with JSONL stdin mode', () => {
  const adapter = new TestCodexCliAdapter()

  assert.deepEqual(adapter.args(packet), ['exec', '--json', '-'])
})

test('codex adapter builds a natural language prompt from the packet', () => {
  const adapter = new TestCodexCliAdapter()
  const prompt = adapter.stdin(packet)

  assert.match(prompt, /^You are CodexAgent, a coding assistant\./)
  assert.match(prompt, /Room: Dev Room/)
  assert.match(prompt, /Conversation history:/)
  assert.match(prompt, /Agent: Previous reply/)
  assert.match(prompt, /User: Please fix this/)
  assert.match(prompt, /Respond helpfully and concisely as CodexAgent\./)
  assert.throws(() => JSON.parse(prompt))
})

test('codex adapter parses actual codex agent_message JSONL events', () => {
  const adapter = new TestCodexCliAdapter()

  assert.deepEqual(adapter.parse(JSON.stringify({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: 'Hello!' },
  })), {
    type: 'visible_message',
    run_id: '',
    content: 'Hello!',
  })
})

test('codex adapter parses top-level content and text JSONL events', () => {
  const adapter = new TestCodexCliAdapter()

  assert.deepEqual(adapter.parse(JSON.stringify({ type: 'agent_message', content: 'Top-level content' })), {
    type: 'visible_message',
    run_id: '',
    content: 'Top-level content',
  })
  assert.deepEqual(adapter.parse(JSON.stringify({ type: 'message', text: 'Top-level text' })), {
    type: 'visible_message',
    run_id: '',
    content: 'Top-level text',
  })
})

test('codex adapter ignores non-message JSONL events and returns raw invalid lines', () => {
  const adapter = new TestCodexCliAdapter()

  assert.equal(adapter.parse(JSON.stringify({ type: 'turn.started' })), null)
  assert.deepEqual(adapter.parse('not json'), {
    type: 'visible_message',
    run_id: '',
    content: 'not json',
  })
})
