import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sanitizeAgentOutput } from '../src/lib/agent-output.js'

test('removes leading Codex internal skill chatter while keeping the answer', () => {
  const output =
    'Using `superpowers:using-superpowers` because the session instructions require it before responding. Yes, there can be multiple Codex-style agents in this room.'

  assert.equal(
    sanitizeAgentOutput(output),
    'Yes, there can be multiple Codex-style agents in this room.',
  )
})

test('removes startup-skill narration while keeping the useful response', () => {
  const output =
    "I'll load the required startup skill, then respond directly as Codex Builder. Correct, I am the builder persona in this room."

  assert.equal(sanitizeAgentOutput(output), 'Correct, I am the builder persona in this room.')
})

test('leaves normal agent answers untouched', () => {
  const output =
    'I can implement the evaluator by separating individual answers, debate, and consensus.'

  assert.equal(sanitizeAgentOutput(output), output)
})
