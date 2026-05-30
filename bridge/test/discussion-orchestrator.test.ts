import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildDiscussionPhasePrompt,
  nextDiscussionPhase,
  readDiscussionMetadata,
  selectConsensusAgent,
} from '../src/lib/discussion-orchestrator.js'

test('discussion phases advance from individual to critique to consensus', () => {
  assert.equal(nextDiscussionPhase('individual'), 'critique')
  assert.equal(nextDiscussionPhase('critique'), 'consensus')
  assert.equal(nextDiscussionPhase('consensus'), null)
})

test('discussion phase prompts force critique instead of another solo answer', () => {
  const prompt = buildDiscussionPhasePrompt('critique', 'prove sqrt(2) irrational')

  assert.match(prompt, /critique and synthesis/i)
  assert.match(prompt, /Read the independent agent contributions above/i)
  assert.match(prompt, /Do not restart as a solo solution/i)
})

test('discussion phase 1 asks for teammate contribution rather than final solo solve', () => {
  const prompt = buildDiscussionPhasePrompt('individual', 'evaluate an integral')

  assert.match(prompt, /teammate, not a full final answer/i)
  assert.match(prompt, /@mentioning one other agent/i)
})

test('reads valid discussion metadata only', () => {
  assert.deepEqual(
    readDiscussionMetadata({
      discussion: {
        enabled: true,
        phase: 'individual',
        original_message_id: 'message-1',
        original_prompt: 'math problem',
      },
    }),
    {
      enabled: true,
      phase: 'individual',
      original_message_id: 'message-1',
      original_prompt: 'math problem',
    },
  )

  assert.equal(readDiscussionMetadata({ discussion: { enabled: true, phase: 'unknown' } }), null)
})

test('selects Codex as the consensus agent when available', () => {
  const members = [
    {
      agent_id: 'claude',
      agents: {
        id: 'claude',
        name: 'Claude',
        slug: 'claude_thinker',
        provider: 'claude_code',
        is_active: true,
      },
    },
    {
      agent_id: 'codex',
      agents: {
        id: 'codex',
        name: 'Codex',
        slug: 'codex_builder',
        provider: 'codex_cli',
        is_active: true,
      },
    },
  ]

  assert.equal(selectConsensusAgent(members)?.agent_id, 'codex')
})
