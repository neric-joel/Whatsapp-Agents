import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectKnownClis, KNOWN_CLIS, probeCommand, whichBinary } from '../src/index.js'

// `node` is guaranteed present wherever these tests run (they run under node/tsx),
// so it's a reliable stand-in for "an installed CLI".

test('whichBinary resolves an absolute path that exists', () => {
  assert.equal(whichBinary(process.execPath), process.execPath)
})

test('whichBinary finds a bare command on PATH', () => {
  const resolved = whichBinary('node')
  assert.ok(resolved, 'node should resolve on PATH')
})

test('whichBinary returns null for a command that is not installed', () => {
  assert.equal(whichBinary('definitely-not-a-real-cli-xyz'), null)
})

test('whichBinary returns null for a non-existent absolute path', () => {
  assert.equal(whichBinary('/no/such/binary/here-xyz'), null)
})

test('probeCommand reports ready + a version line for a working binary', async () => {
  const result = await probeCommand('node', ['--version'])
  assert.equal(result.status, 'ready')
  assert.ok(result.path)
  assert.ok(result.version && /\d+\.\d+/.test(result.version))
})

test('probeCommand reports not_found for a missing binary', async () => {
  const result = await probeCommand('definitely-not-a-real-cli-xyz')
  assert.equal(result.status, 'not_found')
  assert.equal(result.path, null)
})

test('detectKnownClis returns one probe per known CLI', async () => {
  const detected = await detectKnownClis()
  assert.equal(detected.length, KNOWN_CLIS.length)
  for (const d of detected) {
    assert.ok(['ready', 'error', 'not_found'].includes(d.status))
    assert.ok(typeof d.authHint === 'string' && d.authHint.length > 0)
  }
})
