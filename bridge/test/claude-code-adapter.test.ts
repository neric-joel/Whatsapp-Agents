import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ClaudeCodeAdapter } from '../src/adapters/claude-code-adapter.js'

class TestClaudeCodeAdapter extends ClaudeCodeAdapter {
  parse(line: string) {
    return this.parseStdoutLine(line)
  }
}

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
