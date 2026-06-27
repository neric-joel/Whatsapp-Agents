import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const tmp = mkdtempSync(join(tmpdir(), 'agentroom-env-'))
process.env['AGENTROOM_HOME'] = tmp

const { environmentFacts } = await import('../src/index.js')

after(() => rmSync(tmp, { recursive: true, force: true }))

test('environmentFacts states local SQLite + the real db path and denies cloud storage', () => {
  const facts = environmentFacts()
  assert.match(facts, /local SQLite/i)
  assert.match(facts, /agentroom\.db/)
  assert.ok(facts.includes(tmp), 'should embed the live app-data path')
  // Explicitly names the wrong answers so an agent won't repeat them.
  assert.match(facts, /NO Supabase/i)
  assert.match(facts, /ChatGPT/i)
})
