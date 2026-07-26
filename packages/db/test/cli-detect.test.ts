import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  buildWindowsCmdCommandLine,
  detectKnownClis,
  KNOWN_CLIS,
  probeCommand,
  runProbe,
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

test('spawnTarget prequotes Windows .cmd paths with spaces for cmd /s /c', () => {
  const bin = 'C:\\Users\\First Last\\AppData\\Roaming\\npm\\gemini.cmd'
  const args = ['--version', 'a&b']
  const target = spawnTarget(bin, args, 'win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' })

  assert.equal(target.command, 'C:\\Windows\\System32\\cmd.exe')
  assert.deepEqual(target.args, ['/d', '/s', '/c', buildWindowsCmdCommandLine(bin, args)])
  assert.equal(target.windowsVerbatimArguments, true)
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

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForFile(path: string, budgetMs = 3000): Promise<string> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    try {
      const content = readFileSync(path, 'utf8').trim()
      if (content) return content
    } catch {
      /* not written yet */
    }
    await wait(50)
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function waitDead(pid: number, budgetMs = 3000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await wait(50)
  }
  return !alive(pid)
}

test(
  'Windows: version probe timeout tree-kills a .cmd shim descendant',
  { skip: process.platform === 'win32' ? false : 'Windows-only taskkill /T behavior' },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentroom probe kill '))
    const marker = join(dir, 'grandchild.pid')
    const script = join(dir, 'spawn-grandchild.cjs')
    const shim = join(dir, 'hung probe.cmd')
    writeFileSync(
      script,
      [
        "const { spawn } = require('node:child_process')",
        "const fs = require('node:fs')",
        "const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' })",
        'fs.writeFileSync(process.argv[2], String(gc.pid))',
        'setInterval(() => {}, 1e9)',
      ].join('\n'),
    )
    writeFileSync(shim, '@echo off\r\nnode "%~dp0spawn-grandchild.cjs" %*\r\n')

    const probe = runProbe(shim, [marker], 300)
    const grandchildPid = Number(await waitForFile(marker))
    assert.equal(alive(grandchildPid), true, 'grandchild is running before timeout')

    const result = await probe
    assert.equal(result.timedOut, true)
    assert.equal(await waitDead(grandchildPid), true, 'grandchild reaped by taskkill /T')
  },
)

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
