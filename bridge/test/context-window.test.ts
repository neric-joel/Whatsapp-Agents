import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_CONTEXT_MESSAGE_LIMIT,
  DEFAULT_CONTEXT_MESSAGE_MAX_CHARS,
  readContextMessageLimit,
  readContextMessageMaxChars,
  trimContextContent,
  trimContextMessages,
} from '../src/context/context-window.js'

test('context message limit defaults and clamps to a safe range', () => {
  assert.equal(readContextMessageLimit({}), DEFAULT_CONTEXT_MESSAGE_LIMIT)
  assert.equal(readContextMessageLimit({ AGENTROOM_CONTEXT_MESSAGE_LIMIT: '999' }), 20)
  assert.equal(readContextMessageLimit({ AGENTROOM_CONTEXT_MESSAGE_LIMIT: '-4' }), 0)
  assert.equal(
    readContextMessageLimit({ AGENTROOM_CONTEXT_MESSAGE_LIMIT: 'bad' }),
    DEFAULT_CONTEXT_MESSAGE_LIMIT,
  )
})

test('context message char limit defaults and clamps to a safe range', () => {
  assert.equal(readContextMessageMaxChars({}), DEFAULT_CONTEXT_MESSAGE_MAX_CHARS)
  assert.equal(readContextMessageMaxChars({ AGENTROOM_CONTEXT_MESSAGE_MAX_CHARS: '20' }), 200)
  assert.equal(readContextMessageMaxChars({ AGENTROOM_CONTEXT_MESSAGE_MAX_CHARS: '99999' }), 8000)
  assert.equal(
    readContextMessageMaxChars({ AGENTROOM_CONTEXT_MESSAGE_MAX_CHARS: 'bad' }),
    DEFAULT_CONTEXT_MESSAGE_MAX_CHARS,
  )
})

test('trims oversized context message content with an explicit marker', () => {
  assert.equal(trimContextContent('short', 10), 'short')
  assert.equal(
    trimContextContent('abcdefghijklmnopqrstuvwxyz', 10),
    'abcdefghij\n[...truncated 16 chars]',
  )
})

test('trims each context message without mutating the original objects', () => {
  const messages = [{ id: 'm1', content: 'abcdefghijklmnopqrstuvwxyz' }]
  const trimmed = trimContextMessages(messages, 5)

  assert.equal(messages[0].content, 'abcdefghijklmnopqrstuvwxyz')
  assert.deepEqual(trimmed, [{ id: 'm1', content: 'abcde\n[...truncated 21 chars]' }])
})
