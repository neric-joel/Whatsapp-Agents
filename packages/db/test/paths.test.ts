import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

// Isolate the app-data home so mkdir/chmod calls hit a throwaway dir.
const tmp = mkdtempSync(join(tmpdir(), 'agentroom-paths-'))
process.env['AGENTROOM_HOME'] = tmp

const { appDataDir, filesDir, ensureAppDirs } = await import('../src/index.js')

after(() => rmSync(tmp, { recursive: true, force: true }))

// `mode` on mkdirSync/chmodSync only carries POSIX permission-bit meaning on POSIX;
// on Windows chmod merely toggles the read-only attribute, so these assertions are
// skipped there rather than failing. Matches bridge/test/subprocess-killtree.test.ts.
const isPosix = process.platform !== 'win32'

function permBits(path: string): number {
  return statSync(path).mode & 0o777
}

test(
  'ensureAppDirs creates a fresh app-data dir and files dir at 0700, not the umask default',
  { skip: isPosix ? false : 'POSIX file-mode bits are not meaningful on Windows' },
  () => {
    ensureAppDirs()
    assert.equal(permBits(appDataDir()), 0o700)
    assert.equal(permBits(filesDir()), 0o700)
  },
)

test(
  'ensureAppDirs tightens an already-existing, over-permissive app-data/files dir (upgrade path)',
  { skip: isPosix ? false : 'POSIX file-mode bits are not meaningful on Windows' },
  () => {
    ensureAppDirs()
    chmodSync(appDataDir(), 0o755)
    chmodSync(filesDir(), 0o755)
    // Sanity: confirm the precondition actually loosened before re-asserting the fix.
    assert.equal(permBits(appDataDir()), 0o755)
    assert.equal(permBits(filesDir()), 0o755)

    ensureAppDirs()

    assert.equal(permBits(appDataDir()), 0o700)
    assert.equal(permBits(filesDir()), 0o700)
  },
)
