import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ContextPacketV1 } from '@agentroom/shared'

import { buildAgentPrompt } from '../src/adapters/prompt.js'

function packet(environment?: string): ContextPacketV1 {
  return {
    schema_version: 1,
    run_id: 'r',
    room: {
      id: 'r',
      name: 'R',
      reply_mode: 'everyone',
      max_agent_rounds: 3,
      discussion_mode: 'independent',
    },
    agent: { id: 'a', name: 'A', slug: 'a', system_prompt: 'Be helpful.', provider: 'mock' },
    ...(environment ? { environment } : {}),
    trigger_message: {
      id: 'm',
      content: 'Where is this chat stored?',
      sender_type: 'user',
      created_at: '2026-06-27T00:00:00.000Z',
    },
    recent_messages: [],
    round_index: 0,
    discussion_mode: 'independent',
    deliberation_depth: 0,
    deliberation_root_id: null,
  }
}

test('buildAgentPrompt injects the environment grounding before the persona', () => {
  const env = 'ABOUT YOUR ENVIRONMENT: local SQLite; NO Supabase.'
  const prompt = buildAgentPrompt(packet(env))
  assert.ok(prompt.includes(env), 'environment facts must be present')
  // Grounding comes before the persona/system prompt so it anchors the answer.
  assert.ok(
    prompt.indexOf(env) < prompt.indexOf('Be helpful.'),
    'environment must precede the persona',
  )
})

test('buildAgentPrompt omits the environment section when none is set', () => {
  const prompt = buildAgentPrompt(packet())
  assert.ok(!prompt.includes('ABOUT YOUR ENVIRONMENT'))
})
