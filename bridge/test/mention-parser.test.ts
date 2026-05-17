import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseMentions } from '../src/lib/mention-parser.js'

const agents = [
  { id: 'codex', slug: 'codex_builder', name: 'Codex Builder' },
  { id: 'reviewer', slug: 'reviewer', name: 'Reviewer' },
]

test('parses agent name mentions with spaces', () => {
  assert.deepEqual(parseMentions('@Codex Builder please respond', agents), [
    { type: 'agent', slug: 'codex_builder', agent_id: 'codex', raw: '@Codex Builder' },
  ])
})

test('parses slug mentions and everyone', () => {
  assert.deepEqual(parseMentions('@reviewer @everyone', agents), [
    { type: 'agent', slug: 'reviewer', agent_id: 'reviewer', raw: '@reviewer' },
    { type: 'everyone', raw: '@everyone' },
  ])
})
