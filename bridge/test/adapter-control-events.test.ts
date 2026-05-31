import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AgentEvent, ContextPacketV1 } from '@agentroom/shared'

import { ClaudeCodeAdapter } from '../src/adapters/claude-code-adapter.js'
import { CodexCliAdapter } from '../src/adapters/codex-cli-adapter.js'

// Probes expose the protected stdout parser so we can prove that agent-emitted
// control envelopes (Phase 9 memory_op, Phase 10 handoff_requested) are actually
// turned into AgentEvents — i.e. the features are wired end-to-end, not just
// consumed by a path nothing produces.
class ClaudeProbe extends ClaudeCodeAdapter {
  parse(line: string): AgentEvent | null {
    return this.parseStdoutLine(line)
  }
}
class CodexProbe extends CodexCliAdapter {
  parse(line: string): AgentEvent | null {
    return this.parseStdoutLine(line)
  }
}

test('claude adapter emits handoff_requested from a stdout envelope', () => {
  const ev = new ClaudeProbe().parse(
    JSON.stringify({
      type: 'handoff_requested',
      to_agent_slug: 'reviewer',
      reason: 'please check',
    }),
  )
  assert.equal(ev?.type, 'handoff_requested')
  assert.equal((ev as Extract<AgentEvent, { type: 'handoff_requested' }>).to_agent_slug, 'reviewer')
})

test('claude adapter emits memory_op from a stdout envelope', () => {
  const ev = new ClaudeProbe().parse(
    JSON.stringify({ type: 'memory_op', op: 'add', scope: 'room', kind: 'fact', content: 'noted' }),
  )
  assert.equal(ev?.type, 'memory_op')
  assert.equal((ev as Extract<AgentEvent, { type: 'memory_op' }>).content, 'noted')
})

test('codex adapter defers control envelopes to the base parser', () => {
  const ev = new CodexProbe().parse(
    JSON.stringify({ type: 'handoff_requested', to_agent_slug: 'builder', reason: 'build it' }),
  )
  assert.equal(ev?.type, 'handoff_requested')
})

test('a normal final_response is still parsed (no regression)', () => {
  const packet = { run_id: 'r1' } as ContextPacketV1
  const ev = new ClaudeProbe().parse(
    JSON.stringify({ schema_version: 1, run_id: packet.run_id, content: 'hello' }),
  )
  assert.equal(ev?.type, 'final_response')
})

test('a handoff envelope without to_agent_slug is not treated as a control event', () => {
  const ev = new ClaudeProbe().parse(JSON.stringify({ type: 'handoff_requested', reason: 'x' }))
  // claude falls back to super → no recognized shape → null
  assert.equal(ev, null)
})
