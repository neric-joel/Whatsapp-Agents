#!/usr/bin/env node
/**
 * `npx agentroom` — the published entry point.
 *
 * This package deliberately ships NO app code: the bin you are reading downloads the
 * AgentRoom source for its own exact version (the `vX.Y.Z` git tag this package was
 * published from), caches it under `~/.agentroom/app/X.Y.Z/`, and runs the repo's own
 * launcher (`scripts/launch.mjs` — install → build → start web + bridge → open the
 * browser). That keeps the npm artifact tiny and auditable, makes the GitHub tag the
 * single source of truth, and means `npx agentroom` does exactly what the README's
 * `git clone && pnpm start` quickstart does — minus the clone.
 *
 * First run is honest work: it downloads the source (~a few MB), installs
 * dependencies, and builds the web app — expect a few minutes. Later runs reuse the
 * cache and start quickly (launch.mjs rebuilds unless AGENTROOM_SKIP_BUILD=1).
 *
 * Env:
 *   AGENTROOM_SOURCE_TARBALL  path or URL of a source tarball to use instead of the
 *                             GitHub tag archive (used by the release clean-room test,
 *                             where the next tag doesn't exist on GitHub yet).
 *   AGENTROOM_APP_CACHE       override the cache dir (default ~/.agentroom/app).
 *   AGENTROOM_FORCE_FETCH=1   re-download even if the version is already cached.
 *   (launch.mjs env also applies: AGENTROOM_NO_OPEN, AGENTROOM_SKIP_BUILD, PORT.)
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
const VERSION = pkg.version
const REPO_TARBALL = `https://github.com/neric-joel/Whatsapp-Agents/archive/refs/tags/v${VERSION}.tar.gz`
const MIN_NODE = [22, 13, 0]
const isWin = process.platform === 'win32'

const log = (msg) => console.log(`[agentroom] ${msg}`)
const fail = (msg) => {
  console.error(`[agentroom] ${msg}`)
  process.exit(1)
}

function checkNode() {
  const cur = process.versions.node.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((cur[i] ?? 0) > MIN_NODE[i]) return
    if ((cur[i] ?? 0) < MIN_NODE[i]) {
      fail(
        `AgentRoom needs Node >= ${MIN_NODE.join('.')} (you have ${process.versions.node}). ` +
          'Install it from https://nodejs.org and re-run `npx agentroom`.',
      )
    }
  }
}

/** pnpm is required by the app's own launcher. Probe it; try corepack; else instruct. */
function ensurePnpm() {
  // Fixed command strings only — nothing user-controlled reaches the shell.
  const probe = () => spawnSync('pnpm --version', { shell: true, encoding: 'utf8' })
  if (probe().status === 0) return
  log('pnpm not found — trying `corepack enable` (corepack ships with Node)…')
  spawnSync('corepack enable', { shell: true, stdio: 'ignore' })
  spawnSync(`corepack prepare pnpm@${pkg.packageManager?.split('@')[1] ?? 'latest'} --activate`, {
    shell: true,
    stdio: 'ignore',
  })
  if (probe().status === 0) return
  fail(
    'pnpm is required. Enable it with `corepack enable` or install it with ' +
      '`npm install -g pnpm`, then re-run `npx agentroom`.',
  )
}

async function download(url, dest) {
  log(`Downloading AgentRoom v${VERSION} source…`)
  log(`  ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    fail(
      `Download failed (${res.status} ${res.statusText}). If the tag v${VERSION} is not on ` +
        'GitHub yet, or you are offline, you can still use the git quickstart: ' +
        'https://github.com/neric-joel/Whatsapp-Agents#quickstart',
    )
  }
  mkdirSync(dirname(dest), { recursive: true })
  const file = createWriteStream(dest)
  const { Readable } = await import('node:stream')
  const { pipeline } = await import('node:stream/promises')
  await pipeline(Readable.fromWeb(res.body), file)
}

/** Extract tarball into a temp dir, then move its single top-level dir to appDir. */
async function extract(tarball, appDir) {
  const tarProbe = spawnSync('tar --version', { shell: true, encoding: 'utf8' })
  if (tarProbe.status !== 0) {
    fail(
      '`tar` was not found on PATH (it ships with Windows 10+, macOS, and Linux). ' +
        'Install tar, or use the git quickstart instead: ' +
        'https://github.com/neric-joel/Whatsapp-Agents#quickstart',
    )
  }
  const scratch = join(tmpdir(), `agentroom-extract-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })
  // Static argv, shell:false — the paths come from us, but no interpolation anyway.
  const res = spawnSync('tar', ['-xzf', tarball, '-C', scratch], { stdio: 'inherit', shell: false })
  if (res.status !== 0) fail('Extraction failed — see tar output above.')
  const entries = await readdir(scratch)
  const top = entries.length === 1 ? join(scratch, entries[0]) : scratch
  if (!existsSync(join(top, 'scripts', 'launch.mjs'))) {
    fail(`The downloaded archive does not look like AgentRoom (no scripts/launch.mjs).`)
  }
  mkdirSync(dirname(appDir), { recursive: true })
  rmSync(appDir, { recursive: true, force: true })
  renameSync(top, appDir)
  rmSync(scratch, { recursive: true, force: true })
}

async function main() {
  checkNode()
  const cacheRoot = process.env.AGENTROOM_APP_CACHE ?? join(homedir(), '.agentroom', 'app')
  const appDir = join(cacheRoot, VERSION)
  const cached = existsSync(join(appDir, 'scripts', 'launch.mjs'))

  if (!cached || process.env.AGENTROOM_FORCE_FETCH === '1') {
    const override = process.env.AGENTROOM_SOURCE_TARBALL
    let tarball
    if (override && !/^https?:\/\//.test(override)) {
      tarball = resolve(override)
      if (!existsSync(tarball)) fail(`AGENTROOM_SOURCE_TARBALL not found: ${tarball}`)
      log(`Using local source tarball ${tarball}`)
    } else {
      tarball = join(cacheRoot, `agentroom-v${VERSION}.tar.gz`)
      await download(override ?? REPO_TARBALL, tarball)
    }
    await extract(tarball, appDir)
    log(`Source ready at ${appDir}`)
    log('First run installs dependencies and builds the app — this takes a few minutes.')
  } else {
    log(`Using cached AgentRoom v${VERSION} at ${appDir}`)
  }

  ensurePnpm()

  // Hand over to the repo's own launcher; it owns install/build/run/teardown.
  const child = spawn(process.execPath, [join(appDir, 'scripts', 'launch.mjs')], {
    cwd: appDir,
    stdio: 'inherit',
  })
  child.on('exit', (code) => process.exit(code ?? 0))
  // Ctrl-C reaches the child via the shared console on Windows; forward on POSIX.
  if (!isWin) {
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => {
        try {
          child.kill(sig)
        } catch {
          /* already gone */
        }
      })
    }
  }
}

main().catch((err) => fail(`Fatal: ${err?.stack ?? err}`))
