import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { validateWorkingDir, workspaceRoot } from '../src/working-dir.js'

// A realistic layout: an allow-root with a legit project folder inside it, and a sibling
// folder OUTSIDE the root that traversal/symlink attempts will try to reach.
let base: string // parent of both root and outside
let root: string // the allow-root
let inside: string // root/projects/app  (legit)
let outside: string // base/secret       (out of base)

before(() => {
  base = mkdtempSync(join(tmpdir(), 'agentroom-wd-'))
  root = join(base, 'root')
  inside = join(root, 'projects', 'app')
  outside = join(base, 'secret')
  mkdirSync(inside, { recursive: true })
  mkdirSync(outside, { recursive: true })
})
after(() => rmSync(base, { recursive: true, force: true }))

test('accepts a real directory inside the allow-root and returns its canonical path', () => {
  const r = validateWorkingDir(inside, { root })
  assert.equal(r.ok, true)
  assert.ok(r.path)
  // Canonical path points at the same folder (case-insensitive on Windows).
  assert.equal(r.path?.toLowerCase().endsWith(join('projects', 'app').toLowerCase()), true)
})

test('accepts the allow-root itself', () => {
  assert.equal(validateWorkingDir(root, { root }).ok, true)
})

test('rejects a directory OUTSIDE the allow-root', () => {
  const r = validateWorkingDir(outside, { root })
  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /inside/i)
})

test('rejects `..` traversal that escapes the allow-root', () => {
  const escape = join(inside, '..', '..', '..', 'secret') // -> base/secret
  const r = validateWorkingDir(escape, { root })
  assert.equal(r.ok, false)
})

test('rejects a symlink/junction inside the root that points OUTSIDE it (symlink escape)', () => {
  const link = join(root, 'escape-link')
  try {
    // 'junction' avoids needing admin on Windows; ignored (plain symlink) on POSIX.
    symlinkSync(outside, link, 'junction')
  } catch {
    return // environment can't create links — skip (traversal test already covers escape)
  }
  const r = validateWorkingDir(link, { root })
  assert.equal(r.ok, false, 'a link resolving outside the root must be rejected')
})

test('rejects UNC and device paths', () => {
  for (const p of [
    '\\\\server\\share',
    '//server/share',
    '\\\\?\\C:\\Windows',
    '\\\\.\\PHYSICALDRIVE0',
  ]) {
    const r = validateWorkingDir(p, { root })
    assert.equal(r.ok, false, `UNC/device path should be rejected: ${p}`)
  }
})

test('rejects relative paths', () => {
  assert.equal(validateWorkingDir('projects/app', { root }).ok, false)
  assert.equal(validateWorkingDir('./app', { root }).ok, false)
})

test('rejects a non-existent folder', () => {
  const r = validateWorkingDir(join(root, 'does-not-exist-xyz'), { root })
  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /not found|inside/i)
})

test('rejects empty input and a null byte', () => {
  assert.equal(validateWorkingDir('', { root }).ok, false)
  assert.equal(validateWorkingDir('   ', { root }).ok, false)
  assert.equal(validateWorkingDir(join(root, 'a\0b'), { root }).ok, false)
})

test('workspaceRoot honors AGENTROOM_WORKSPACE_ROOT, else defaults to home', () => {
  const prev = process.env['AGENTROOM_WORKSPACE_ROOT']
  try {
    process.env['AGENTROOM_WORKSPACE_ROOT'] = root
    assert.equal(workspaceRoot(), root)
    // With the env-set root, a folder inside it validates with NO explicit opts.
    assert.equal(validateWorkingDir(inside).ok, true)
    // And one outside it is rejected.
    assert.equal(validateWorkingDir(outside).ok, false)

    delete process.env['AGENTROOM_WORKSPACE_ROOT']
    assert.equal(typeof workspaceRoot(), 'string')
    assert.ok(workspaceRoot().length > 0) // defaults to homedir()
  } finally {
    if (prev === undefined) delete process.env['AGENTROOM_WORKSPACE_ROOT']
    else process.env['AGENTROOM_WORKSPACE_ROOT'] = prev
  }
})
