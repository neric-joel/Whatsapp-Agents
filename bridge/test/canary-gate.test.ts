import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ContextPacketV1 } from '@agentroom/shared'

import { buildAgentPrompt } from '../src/adapters/prompt.js'

function packetWithPeer(canaryStatus: string | undefined): ContextPacketV1 {
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
    agent: { id: 'me', name: 'Me', slug: 'me', system_prompt: null, provider: 'mock' },
    trigger_message: {
      id: 'trigger',
      content: 'What is the storage?',
      sender_type: 'user',
      created_at: '2026-06-27T00:00:02.000Z',
    },
    recent_messages: [
      {
        id: 'peer',
        content: 'It is stored in Supabase Postgres.',
        sender_type: 'agent',
        sender_agent_id: 'other',
        created_at: '2026-06-27T00:00:01.000Z',
        metadata: canaryStatus ? { canary: { status: canaryStatus } } : {},
      },
    ],
    round_index: 1,
    discussion_mode: 'independent',
    deliberation_depth: 0,
    deliberation_root_id: null,
  }
}

test('a flagged peer reply is labelled UNVERIFIED in the next agent prompt (propagation gate)', () => {
  const prompt = buildAgentPrompt(packetWithPeer('flagged'))
  assert.match(prompt, /\[UNVERIFIED — a hallucination check flagged this/i)
  assert.match(prompt, /do NOT treat it as true/i)
})

test('an unverified peer reply is labelled with caution', () => {
  const prompt = buildAgentPrompt(packetWithPeer('unverified'))
  assert.match(prompt, /\[UNVERIFIED — not independently confirmed/i)
})

test('a clean (verified / unlabelled) peer reply gets no warning prefix', () => {
  const verified = buildAgentPrompt(packetWithPeer('verified'))
  const none = buildAgentPrompt(packetWithPeer(undefined))
  assert.doesNotMatch(verified, /\[UNVERIFIED/i)
  assert.doesNotMatch(none, /\[UNVERIFIED/i)
})
