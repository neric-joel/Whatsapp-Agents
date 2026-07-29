import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildWindowsCmdCommandLine, needsWindowsCmdCommandLine } from '../src/windows-cmd.js'

/**
 * The MSVCRT / CommandLineToArgvW quoting rules are asymmetric: a run of n backslashes
 * becomes 2n+1 in front of a `"` and 2n in front of the closing quote, and stays n
 * everywhere else. Getting the RUN LENGTH wrong is the whole bug class — an even count
 * before a quote leaves that quote a live delimiter, which silently changes which
 * argument the following text belongs to. These tests therefore assert exact counts,
 * and then re-parse the emitted command line to prove the argument survives as data.
 */

/** Lengths of every backslash run in `s`, in order. */
function backslashRuns(s: string): number[] {
  return [...s.matchAll(/\\+/g)].map((m) => m[0].length)
}

/**
 * Reference implementation of the CommandLineToArgvW parser (post-`cmd /s /c` quote
 * stripping), written from the documented rules — deliberately NOT sharing code with
 * the escaper, so it is an independent check rather than a restatement.
 */
function parseArgv(commandLine: string): string[] {
  const argv: string[] = []
  let cur = ''
  let started = false
  let inQuotes = false
  let backslashes = 0
  for (const ch of commandLine) {
    if (ch === '\\') {
      backslashes++
      continue
    }
    if (ch === '"') {
      cur += '\\'.repeat(Math.floor(backslashes / 2))
      if (backslashes % 2 === 1) cur += '"'
      else inQuotes = !inQuotes
      started = true
      backslashes = 0
      continue
    }
    cur += '\\'.repeat(backslashes)
    backslashes = 0
    if (!inQuotes && /\s/.test(ch)) {
      if (started) argv.push(cur)
      cur = ''
      started = false
      continue
    }
    cur += ch
    started = true
  }
  cur += '\\'.repeat(backslashes)
  if (started) argv.push(cur)
  return argv
}

/**
 * What cmd.exe hands to the shim: `/s` strips the outer quote pair, then the two caret
 * passes are consumed (each metacharacter arrives as `^^^X`). Valid for arguments that
 * contain no literal `^`, which is all of them below.
 */
function cmdSees(commandLine: string): string {
  return commandLine.slice(1, -1).replace(/\^\^\^(.)/g, '$1')
}

test('escaper doubles a FULL run of backslashes before a quote (n=2 → 2n+1 = 5)', () => {
  // `a\\"b` — two backslashes then a quote. The atomic-lookahead form emitted 4.
  const line = buildWindowsCmdCommandLine('bin', ['a\\\\"b'])
  assert.deepEqual(backslashRuns(line), [5])
})

test('escaper doubles a FULL trailing run of backslashes (n=2 → 2n = 4)', () => {
  // `x\\` — the atomic-lookahead form emitted 3, an odd count that escapes the
  // closing quote so the argument never terminates.
  const line = buildWindowsCmdCommandLine('bin', ['x\\\\'])
  assert.deepEqual(backslashRuns(line), [4])
})

test('escaper leaves interior single backslashes alone and doubles only the trailing run', () => {
  // `C:\a\b\\` — a realistic Windows path with a doubled separator at the end.
  const line = buildWindowsCmdCommandLine('bin', ['C:\\a\\b\\\\'])
  assert.deepEqual(backslashRuns(line), [1, 1, 4])
})

test('escaped arguments round-trip back to the exact original strings', () => {
  const args = [
    'a\\\\"b',
    'x\\\\',
    'C:\\a\\b\\\\',
    'plain',
    'has space',
    'q"uote',
    'one\\',
    'a\\"b',
    'a\\\\\\"b',
    '\\\\\\\\',
    '',
  ]
  const line = buildWindowsCmdCommandLine('bin', args)
  assert.deepEqual(parseArgv(cmdSees(line)), ['bin', ...args])
})

test('needsWindowsCmdCommandLine flags only tokens cmd.exe would misparse', () => {
  assert.equal(needsWindowsCmdCommandLine('C:\\bin\\claude.cmd', ['--print']), false)
  assert.equal(needsWindowsCmdCommandLine('C:\\Program Files\\claude.cmd', ['--print']), true)
  assert.equal(needsWindowsCmdCommandLine('C:\\bin\\claude.cmd', ['a&b']), true)
})
