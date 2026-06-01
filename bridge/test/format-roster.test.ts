import assert from 'node:assert/strict'
import { test } from 'node:test'

import { formatRosterForPrompt } from '../src/agents/format-roster.js'

test('returns null when there is no roster', () => {
  assert.equal(formatRosterForPrompt(undefined), null)
  assert.equal(formatRosterForPrompt([]), null)
})

test('renders peers with their capability blurbs as reference data', () => {
  const out = formatRosterForPrompt([
    { id: 'b', name: 'Reviewer', slug: 'reviewer', capabilities: 'Reviews for risks.' },
    { id: 'c', name: 'Builder', slug: 'codex_builder', capabilities: null },
  ])!
  assert.match(out, /OTHER AGENTS IN THIS ROOM/)
  assert.match(out, /reference data/i)
  assert.match(out, /Reviewer \(@reviewer\) — Reviews for risks\./)
  // null capabilities → no trailing dash
  assert.match(out, /Builder \(@codex_builder\)$/m)
})
