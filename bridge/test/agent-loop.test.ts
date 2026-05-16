import assert from 'node:assert/strict'
import { test } from 'node:test'

import { shouldEnqueueAgentFollowUp } from '../src/lib/agent-loop.js'

test('does not auto-enqueue a same-agent follow-up without an explicit target', () => {
  assert.equal(
    shouldEnqueueAgentFollowUp({
      allowAgentToAgent: true,
      isConclusion: false,
      explicitTargetAgentIds: [],
    }),
    false,
  )
})

test('allows a follow-up only for explicit agent targets', () => {
  assert.equal(
    shouldEnqueueAgentFollowUp({
      allowAgentToAgent: true,
      isConclusion: false,
      explicitTargetAgentIds: ['agent-2'],
    }),
    true,
  )
})
