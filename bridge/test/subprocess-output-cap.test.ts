import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SubprocessAdapter } from '../src/adapters/subprocess-adapter.js'
import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

const packet: ContextPacketV1 = {
  schema_version: 1,
  run_id: 'run-cap',
  room: {
    id: 'r',
    name: 'R',
    reply_mode: 'everyone',
    max_agent_rounds: 3,
    discussion_mode: 'independent',
  },
  agent: { id: 'a', name: 'A', slug: 'a', system_prompt: null, provider: 'mock' },
  trigger_message: {
    id: 'm',
    content: 'go',
    sender_type: 'user',
    created_at: '2026-05-30T00:00:00.000Z',
  },
  recent_messages: [],
  round_index: 0,
  discussion_mode: 'independent',
  deliberation_depth: 0,
  deliberation_root_id: null,
}

class FloodingAdapter extends SubprocessAdapter {
  readonly name = 'flood'
  protected resolveCommand(): string {
    return 'node'
  }
  // Write ~2 MB to stdout — well over the cap below.
  protected buildArgs(): string[] {
    return ['-e', "process.stdout.write('x'.repeat(2_000_000))"]
  }
  protected envVarName(): string {
    return 'TEST_BIN'
  }
  protected getMaxOutputBytes(): number {
    return 100_000
  } // 100 KB cap
  protected getTimeoutMs(): number {
    return 10_000
  }
}

test('subprocess adapter kills + errors when a child floods stdout past the output cap', async () => {
  const adapter = new FloodingAdapter()
  const events: AgentEvent[] = []
  for await (const event of adapter.run(packet, new AbortController().signal)) {
    events.push(event)
  }

  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'error')
  assert.match((events[0] as { message: string }).message, /exceeded the 100000-byte output limit/)
})

class QuietAdapter extends SubprocessAdapter {
  readonly name = 'quiet'
  protected resolveCommand(): string {
    return 'node'
  }
  protected buildArgs(): string[] {
    return [
      '-e',
      "process.stdout.write(JSON.stringify({schema_version:1,run_id:'run-cap',content:'ok',content_type:'text'}))",
    ]
  }
  protected envVarName(): string {
    return 'TEST_BIN'
  }
  protected getMaxOutputBytes(): number {
    return 100_000
  }
  protected getTimeoutMs(): number {
    return 10_000
  }
}

test('subprocess adapter does NOT trip the cap for small output', async () => {
  const adapter = new QuietAdapter()
  const events: AgentEvent[] = []
  for await (const event of adapter.run(packet, new AbortController().signal)) {
    events.push(event)
  }

  assert.ok(events.some((e) => e.type === 'final_response'))
  assert.ok(!events.some((e) => e.type === 'error'))
})
