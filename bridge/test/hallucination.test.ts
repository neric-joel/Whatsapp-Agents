import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectHallucination } from '../src/lib/hallucination.js'

test('detects hedging language', () => {
  const result = detectHallucination('I think this might be the right answer.')

  assert.equal(result.flagged, true)
  assert.deepEqual(result.reasons, ['Contains hedging language without grounding'])
})

test('detects citation without verifiable source', () => {
  const result = detectHallucination('According to Example Research, this is settled.')

  assert.equal(result.flagged, true)
  assert.deepEqual(result.reasons, ['Contains citation without verifiable source'])
})

test('detects unqualified absolute claims', () => {
  const result = detectHallucination('This workflow is guaranteed to always works.')

  assert.equal(result.flagged, true)
  assert.deepEqual(result.reasons, ['Contains unqualified absolute claim'])
})

test('does not flag clean content', () => {
  const result = detectHallucination(
    'The next step is to inspect the worker and add metadata to the inserted reply.',
  )

  assert.equal(result.flagged, false)
  assert.equal(result.confidence, 'low')
  assert.deepEqual(result.reasons, [])
})
