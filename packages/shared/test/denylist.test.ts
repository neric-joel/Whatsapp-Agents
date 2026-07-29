import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findDeniedArgument, isDeniedCommand } from '../src/denylist.js'

/**
 * Two properties are under test, and each has a specific way of failing silently.
 *
 * 1. FALSE POSITIVES. `/\bdrop\b/i` and `/\bformat\b/i` denied ordinary English —
 *    `git commit -m "drop legacy flag"`, "format the output as JSON". A denylist that
 *    blocks routine work is a denylist an operator turns off, so the false-positive
 *    cases are asserted alongside the true positives they must not cost.
 * 2. WHERE the scan looks. `findDeniedArgument` must reach every string leaf of an
 *    agent-supplied `arguments` object regardless of the key it sits under, because the
 *    tool — not the bridge — names its own parameters. Scanning `arguments.command`
 *    alone scanned the empty string for everything else.
 */

test('a bare destructive verb in prose is not a destructive command', () => {
  // Each of these was denied by the old /\bdrop\b/i and /\bformat\b/i patterns.
  for (const benign of [
    'git commit -m "drop legacy flag"',
    'git commit -m "drop the v1 compatibility shim"',
    'npm run format',
    'prettier --write . to format the source',
    'format the output as JSON',
    'reformat the changelog',
    'echo "we will drop support for node 20"',
  ]) {
    assert.equal(isDeniedCommand(benign), false, `should be allowed: ${benign}`)
  }
})

test('destructive verbs WITH a real object are still denied', () => {
  for (const denied of [
    'DROP TABLE users',
    'drop table users',
    'drop database prod',
    'DROP SCHEMA public CASCADE',
    'drop index idx_messages_room',
    'mkfs /dev/sda',
    'mkfs.ext4 -F /dev/sdb1',
    'format C:',
    'format c:\\',
    'format D: /fs:ntfs',
    'format /dev/sda',
  ]) {
    assert.equal(isDeniedCommand(denied), true, `should be denied: ${denied}`)
  }
})

test('the pre-existing patterns are unchanged', () => {
  assert.equal(isDeniedCommand('rm -rf /home'), true)
  assert.equal(isDeniedCommand('rm -r -f /tmp/project'), true)
  assert.equal(isDeniedCommand('ｒｍ -rf /tmp/project'), true, 'NFKC normalization still applies')
  assert.equal(isDeniedCommand('TRUNCATE TABLE users'), true)
  assert.equal(isDeniedCommand('DELETE FROM users'), true)
  assert.equal(isDeniedCommand('DELETE FROM users WHERE id = 1'), false)
  assert.equal(isDeniedCommand('ls -la'), false)
  assert.equal(isDeniedCommand('echo hello'), false)
})

test('findDeniedArgument reaches string leaves under ANY key name', () => {
  // The old code read arguments['command'] and nothing else, so every one of these was
  // scanned as the empty string and waved through.
  assert.equal(findDeniedArgument({ cmd: 'rm -rf /' }), 'rm -rf /')
  assert.equal(findDeniedArgument({ script: 'DROP TABLE users' }), 'DROP TABLE users')
  assert.equal(findDeniedArgument({ args: 'mkfs /dev/sda' }), 'mkfs /dev/sda')
})

test('findDeniedArgument descends into nested objects and arrays', () => {
  assert.equal(findDeniedArgument({ shell: { exec: { run: 'rm -rf /' } } }), 'rm -rf /')
  assert.equal(findDeniedArgument({ argv: ['bash', '-lc', 'rm -rf /'] }), 'rm -rf /')
  assert.equal(
    findDeniedArgument({ steps: [{ name: 'cleanup', run: { command: 'DROP TABLE users' } }] }),
    'DROP TABLE users',
  )
  assert.equal(findDeniedArgument([[['format C:']]]), 'format C:')
})

test('findDeniedArgument returns null for clean and non-string payloads', () => {
  assert.equal(findDeniedArgument({ command: 'ls -la' }), null)
  assert.equal(findDeniedArgument({ nested: { n: 1, ok: true, nothing: null } }), null)
  assert.equal(findDeniedArgument({}), null)
  assert.equal(findDeniedArgument(undefined), null)
  assert.equal(findDeniedArgument('ls -la'), null)
})

test('findDeniedArgument terminates on cyclic and pathological input', () => {
  const cyclic: Record<string, unknown> = { name: 'loop' }
  cyclic['self'] = cyclic
  cyclic['sibling'] = { back: cyclic }
  assert.equal(findDeniedArgument(cyclic), null)

  // A cycle must not hide a denied leaf that is reachable within the depth bound.
  const cyclicWithPayload: Record<string, unknown> = { cmd: 'rm -rf /' }
  cyclicWithPayload['self'] = cyclicWithPayload
  assert.equal(findDeniedArgument(cyclicWithPayload), 'rm -rf /')

  // Deeper than the depth bound: the walk stops instead of recursing without limit.
  let deep: Record<string, unknown> = { leaf: 'ls -la' }
  for (let i = 0; i < 5000; i++) deep = { next: deep }
  assert.equal(findDeniedArgument(deep), null)

  // Wide input is bounded by the node budget, not by the stack.
  const wide: Record<string, unknown> = {}
  for (let i = 0; i < 50_000; i++) wide[`k${i}`] = 'ls -la'
  assert.equal(findDeniedArgument(wide), null)
})
