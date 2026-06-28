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

test('dedupes repeated reasons and does not inflate confidence (regression: dup-key + false-high)', () => {
  // Two independent self-contradictions trigger the SAME reason twice in the raw scan.
  // Pre-fix this yielded ['Potential self-contradiction detected', 'Potential self-contradiction
  // detected'] -> confidence 'medium' (count===2) AND a non-unique React key in the banner.
  const text =
    'the deployment is safe. the rollback is clean. the deployment is not safe. the rollback is not clean.'
  const result = detectHallucination(text)

  assert.equal(result.flagged, true)
  // reasons must be unique (the banner keys by them; confidence is derived from the count)
  assert.equal(result.reasons.length, new Set(result.reasons).size, 'reasons must be deduped')
  assert.deepEqual(result.reasons, ['Potential self-contradiction detected'])
  // one distinct category => 'low', NOT inflated to 'medium' by duplicate hits
  assert.equal(result.confidence, 'low')
})

test('bounds work on a huge adversarial reply (DoS guard) and still flags within the prefix', () => {
  // A malicious or compromised CLI could emit a multi-MB reply of many short clauses to drive
  // the O(sentences^2) self-contradiction scan. The MAX_SCAN_CHARS / MAX_SENTENCES caps must keep
  // this bounded; a contradiction inside the scanned prefix is still detected. Without the cap the
  // ~50k-sentence input below would be ~10^9 comparisons (seconds-to-minutes); capped, it is instant.
  const contradiction = 'the deployment is safe. the deployment is not safe. '
  const huge = contradiction + 'x is y. '.repeat(50_000)
  const start = Date.now()
  const result = detectHallucination(huge)
  const ms = Date.now() - start

  assert.equal(result.flagged, true)
  assert.ok(
    result.reasons.includes('Potential self-contradiction detected'),
    'contradiction in the scanned prefix is still detected',
  )
  assert.ok(ms < 1000, `detectHallucination must stay bounded on huge input (took ${ms}ms)`)
})

test('does not flag clean content', () => {
  const result = detectHallucination(
    'The next step is to inspect the worker and add metadata to the inserted reply.',
  )

  assert.equal(result.flagged, false)
  assert.equal(result.confidence, 'low')
  assert.deepEqual(result.reasons, [])
})
