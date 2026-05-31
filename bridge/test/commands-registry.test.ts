import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  allowedCommands,
  COMMAND_REGISTRY,
  extractCommand,
  formatHelp,
  getCommandSpec,
  roleAllows,
} from '@agentroom/shared'

test('registry exposes the v1 command set', () => {
  for (const name of [
    'help',
    'commands',
    'discuss',
    'remember',
    'recall',
    'handoff',
    'agents',
    'pin',
    'reset',
  ]) {
    assert.ok(getCommandSpec(name), `missing command: ${name}`)
  }
})

test('getCommandSpec is case-insensitive and returns undefined for unknown', () => {
  assert.equal(getCommandSpec('HELP')?.name, 'help')
  assert.equal(getCommandSpec('nope'), undefined)
})

test('roleAllows enforces owner > admin > member', () => {
  assert.equal(roleAllows('member', 'member'), true)
  assert.equal(roleAllows('member', 'admin'), false)
  assert.equal(roleAllows('admin', 'admin'), true)
  assert.equal(roleAllows('admin', 'member'), true)
  assert.equal(roleAllows('owner', 'admin'), true)
})

test('a member cannot run an admin-only command (/reset)', () => {
  assert.equal(roleAllows('member', COMMAND_REGISTRY.reset!.minRole), false)
  assert.equal(roleAllows('admin', COMMAND_REGISTRY.reset!.minRole), true)
})

test('allowedCommands lists exactly the caller-permitted commands', () => {
  const memberCmds = allowedCommands('member').map((c) => c.name)
  assert.ok(memberCmds.includes('help'))
  assert.ok(memberCmds.includes('remember'))
  assert.ok(!memberCmds.includes('reset'), 'member must not see /reset')

  const adminCmds = allowedCommands('admin').map((c) => c.name)
  assert.ok(adminCmds.includes('reset'), 'admin sees /reset')
})

test('extractCommand detects command-like leading slashes only', () => {
  assert.deepEqual(extractCommand('/reset'), { name: 'reset', rest: '' })
  assert.deepEqual(extractCommand('/HELP now'), { name: 'help', rest: 'now' })
  assert.deepEqual(extractCommand('  /recall the plan  '), { name: 'recall', rest: 'the plan' })
  assert.equal(extractCommand('hello world'), null)
  assert.equal(extractCommand('@agent hi'), null)
  assert.equal(extractCommand('/123 fractions'), null)
})

test('formatHelp lists exactly the caller-permitted commands', () => {
  const memberHelp = formatHelp('member')
  assert.match(memberHelp, /\/help/)
  assert.match(memberHelp, /\/remember/)
  assert.doesNotMatch(memberHelp, /\/reset/)

  const adminHelp = formatHelp('admin')
  assert.match(adminHelp, /\/reset/)
})
