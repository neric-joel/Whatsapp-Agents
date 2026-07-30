/**
 * Tests for the PUBLISHED bin, `scripts/npx-bootstrap.mjs` — the artifact users actually
 * run via `npx agentroom`, and the only file `package.json`'s `files` field ships.
 *
 * Nothing else in the repo exercises it: `prepublishOnly` is `node --check` (syntax only),
 * no workspace owns `scripts/`, and the e2e suite drives the web app rather than the
 * installer. So a defect here reaches every user and no gate sees it.
 *
 * Runner is `node --test` directly, not tsx or vitest: the subject is plain `.mjs` with
 * only `node:` imports, so there is nothing to transpile, and vitest's worker model fights
 * a test whose point is spawning the bin as a real subprocess. Invoke by explicit file
 * path — `node --test scripts/test` treats the directory as a module and dies with
 * MODULE_NOT_FOUND on Windows, and a bare `node --test` would execute fixtures as tests.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), 'npx-bootstrap.mjs')

let cacheRoot

before(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'agentroom-bin-test-'))
})

after(() => {
  rmSync(cacheRoot, { recursive: true, force: true })
})

/**
 * Runs the bin with its cache pointed at a throwaway dir and its download forced down a
 * local path that does not exist, so it fails fast and hermetically — no network, no npm,
 * no GitHub. `sweepOrphans` runs before that failure, which is what these tests observe.
 */
function runBin() {
  return spawnSync(process.execPath, [BIN], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AGENTROOM_APP_CACHE: cacheRoot,
      AGENTROOM_SOURCE_TARBALL: join(cacheRoot, 'definitely-absent.tar.gz'),
      AGENTROOM_FORCE_FETCH: '1',
    },
  })
}

/** A pid that is certainly dead: spawn something trivial and wait for it to exit. */
function deadPid() {
  const done = spawnSync(process.execPath, ['-e', '0'])
  assert.equal(done.status, 0, 'helper process should have exited cleanly')
  return done.pid
}

test('the orphan sweep spares a .part still owned by a live process', () => {
  // A second `npx agentroom` started while the first is still downloading used to delete
  // the first's in-flight file — the sweep removed every *.part unconditionally — and the
  // victim then died on an unguarded readFileSync with a raw ENOENT. `.part` names carry
  // their owner's pid exactly so a live download can be told from a leftover.
  const live = join(cacheRoot, `agentroom-v9.9.9.tar.gz.${process.pid}.part`)
  const stale = join(cacheRoot, `agentroom-v9.9.9.tar.gz.${deadPid()}.part`)
  writeFileSync(live, 'in flight')
  writeFileSync(stale, 'leftover')

  const res = runBin()
  assert.notEqual(res.status, 0, 'the absent tarball should make the bin fail, not hang')

  assert.ok(
    existsSync(live),
    `the sweep deleted a live process's in-flight download; cache held: ${readdirSync(cacheRoot).join(', ')}`,
  )
  assert.ok(!existsSync(stale), 'a .part whose owner is gone is an orphan and should be swept')
})

test('the orphan sweep still removes leftovers it cannot attribute', () => {
  // Names predating the pid scheme, and extraction scratch dirs, have no live owner to
  // check — they must still be reclaimed or the cache grows without bound.
  const unattributable = join(cacheRoot, 'agentroom-v9.9.9.tar.gz.part')
  const scratch = join(cacheRoot, '.extract-abc123')
  writeFileSync(unattributable, 'legacy leftover')
  mkdirSync(scratch, { recursive: true })
  writeFileSync(join(scratch, 'inner'), 'x')

  runBin()

  assert.ok(!existsSync(unattributable), 'an unattributable .part should be swept')
  assert.ok(!existsSync(scratch), 'an .extract-* scratch dir should be swept')
})

test('the bin refuses an absent local source tarball instead of proceeding', () => {
  const res = runBin()
  assert.notEqual(res.status, 0)
  assert.match(
    `${res.stdout}${res.stderr}`,
    /AGENTROOM_SOURCE_TARBALL not found/,
    'the failure should name the missing override, not surface a raw stack',
  )
})
