import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  detectKnownClis,
  KNOWN_CLIS,
  probeCommand,
  spawnTarget,
  whichBinary,
} from '../src/index.js'

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

test('spawnTarget routes a Windows .cmd/.bat shim through cmd.exe (no EINVAL)', () => {
  // The real bug Phase 4 hit: codex/gemini resolve to .CMD shims, and Node refuses to
  // spawn those with shell:false (EINVAL). They must go through cmd.exe /d /s /c.
  const env = { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }
  const cmd = spawnTarget('C:\\tools\\codex.CMD', ['exec', '--json'], 'win32', env)
  assert.equal(cmd.command, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(cmd.args, ['/d', '/s', '/c', 'C:\\tools\\codex.CMD', 'exec', '--json'])

  const bat = spawnTarget('x.bat', ['--version'], 'win32', env)
  assert.equal(bat.command, 'C:\\Windows\\System32\\cmd.exe')
})

test('spawnTarget spawns a plain binary directly (exe / POSIX)', () => {
  const exe = spawnTarget('C:\\tools\\claude.EXE', ['--version'], 'win32', {})
  assert.equal(exe.command, 'C:\\tools\\claude.EXE')
  assert.deepEqual(exe.args, ['--version'])

  const posix = spawnTarget('/usr/local/bin/claude', ['--version'], 'linux', {})
  assert.equal(posix.command, '/usr/local/bin/claude')
})

test('detectKnownClis returns one probe per known CLI', async () => {
  const detected = await detectKnownClis()
  assert.equal(detected.length, KNOWN_CLIS.length)
  for (const d of detected) {
    assert.ok(['ready', 'error', 'not_found'].includes(d.status))
    assert.ok(typeof d.authHint === 'string' && d.authHint.length > 0)
  }
})

// Catalog contract (#80): the auto-detect catalog must only offer CLIs that can hold a
// conversation — i.e. each one has a non-empty default invocation that passes a prompt.
// Editor/IDE launchers (e.g. `antigravity`, whose default args were [] and which only
// opens files) must NOT be in the catalog, or the Connections screen would auto-detect a
// "ready" participant that can never reply.
test('KNOWN_CLIS only contains conversational CLIs (no editor/launcher entries)', () => {
  const CONVERSATIONAL_SLUGS = new Set(['claude', 'codex', 'gemini'])
  for (const cli of KNOWN_CLIS) {
    assert.ok(
      CONVERSATIONAL_SLUGS.has(cli.slug),
      `unexpected catalog entry '${cli.slug}' — only conversational CLIs belong in KNOWN_CLIS`,
    )
    assert.ok(
      cli.defaultArgs.length > 0,
      `'${cli.slug}' has empty defaultArgs — a conversational CLI must pass the prompt (e.g. via '-' on stdin)`,
    )
  }
  assert.ok(
    !KNOWN_CLIS.some((c) => c.slug === 'antigravity' || c.key === 'antigravity'),
    'antigravity is an editor CLI, not a conversational agent — it must not be in the catalog (#80)',
  )
})
