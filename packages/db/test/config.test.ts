import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, test } from 'node:test'

// Isolate the app-data home so config.json writes hit a throwaway dir.
const tmp = mkdtempSync(join(tmpdir(), 'agentroom-config-'))
process.env['AGENTROOM_HOME'] = tmp

const {
  readConfig,
  writeConfig,
  listProfiles,
  getProfile,
  upsertProfile,
  deleteProfile,
  configPath,
} = await import('../src/index.js')

before(() => {})
after(() => rmSync(tmp, { recursive: true, force: true }))

beforeEach(() => {
  // Reset to an empty config before each test.
  writeConfig({ version: 1, clis: [] })
})

test('readConfig returns an empty config when the file is missing', () => {
  rmSync(configPath(), { force: true })
  const cfg = readConfig()
  assert.equal(cfg.version, 1)
  assert.deepEqual(cfg.clis, [])
})

test('upsertProfile creates a profile with a generated id + timestamps', () => {
  const saved = upsertProfile({
    name: 'Claude Code',
    slug: 'claude',
    bin: 'claude',
    args: ['--print', '--output-format', 'json'],
    kind: 'claude-code',
    enabled: true,
  })
  assert.ok(saved.id)
  assert.ok(saved.created_at)
  assert.equal(saved.kind, 'claude-code')
  assert.deepEqual(listProfiles().length, 1)
  assert.equal(getProfile(saved.id)?.name, 'Claude Code')
})

test('upsertProfile updates an existing profile by id (no duplicate)', () => {
  const a = upsertProfile({
    name: 'X',
    slug: 'x',
    bin: 'x',
    args: [],
    kind: 'generic',
    enabled: true,
  })
  const b = upsertProfile({
    id: a.id,
    name: 'X renamed',
    slug: 'x',
    bin: '/usr/bin/x',
    args: ['run'],
    kind: 'generic',
    enabled: false,
  })
  assert.equal(b.id, a.id)
  assert.equal(listProfiles().length, 1)
  assert.equal(getProfile(a.id)?.name, 'X renamed')
  assert.equal(getProfile(a.id)?.bin, '/usr/bin/x')
  assert.equal(getProfile(a.id)?.enabled, false)
})

test('per-profile env round-trips and can be cleared on update', () => {
  const a = upsertProfile({
    name: 'E',
    slug: 'e',
    bin: 'e',
    args: [],
    kind: 'generic',
    enabled: true,
    env: { FOO: 'bar' },
  })
  assert.deepEqual(getProfile(a.id)?.env, { FOO: 'bar' })
  // Update without env clears it.
  upsertProfile({
    id: a.id,
    name: 'E',
    slug: 'e',
    bin: 'e',
    args: [],
    kind: 'generic',
    enabled: true,
  })
  assert.equal(getProfile(a.id)?.env, undefined)
})

test('deleteProfile removes by id and reports whether anything was removed', () => {
  const a = upsertProfile({
    name: 'D',
    slug: 'd',
    bin: 'd',
    args: [],
    kind: 'generic',
    enabled: true,
  })
  assert.equal(deleteProfile(a.id), true)
  assert.equal(getProfile(a.id), undefined)
  assert.equal(deleteProfile('nope'), false)
})

test('readConfig tolerates a corrupt file and drops malformed entries', () => {
  writeFileSync(configPath(), '{ this is not json', 'utf8')
  assert.deepEqual(readConfig().clis, [])

  writeFileSync(
    configPath(),
    JSON.stringify({ clis: [{ name: 'no id or bin' }, { id: 'ok', name: 'Ok', bin: 'ok' }] }),
    'utf8',
  )
  const clis = readConfig().clis
  assert.equal(clis.length, 1)
  assert.equal(clis[0]!.id, 'ok')
  assert.equal(clis[0]!.kind, 'generic') // defaulted
  assert.equal(clis[0]!.enabled, true) // defaulted
})
