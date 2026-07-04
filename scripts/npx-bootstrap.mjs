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
 *   AGENTROOM_SOURCE_TARBALL  https:// URL or local path of a source tarball to use
 *                             instead of the GitHub tag archive (used by the release
 *                             clean-room test, where the next tag doesn't exist on
 *                             GitHub yet). Plain http:// is refused.
 *   AGENTROOM_APP_CACHE       override the cache dir (default ~/.agentroom/app).
 *   AGENTROOM_FORCE_FETCH=1   re-download even if the version is already cached.
 *   (launch.mjs env also applies: AGENTROOM_NO_OPEN, AGENTROOM_SKIP_BUILD, PORT.)
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
const VERSION = pkg.version
const REPO_TARBALL = `https://github.com/neric-joel/Whatsapp-Agents/archive/refs/tags/v${VERSION}.tar.gz`
const QUICKSTART = 'https://github.com/neric-joel/Whatsapp-Agents#quickstart'
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

/**
 * pnpm is required by the app's own launcher. Probe it; attempt corepack activation
 * automatically (corepack is bundled with Node 16–24; on newer Node the attempt
 * fails quietly and we fall through to the manual instructions); else instruct.
 */
function ensurePnpm() {
  // Fixed command strings; the only interpolated value is the pnpm version from this
  // package's OWN published manifest, validated to a version-safe charset.
  const probe = () => spawnSync('pnpm --version', { shell: true, encoding: 'utf8' })
  if (probe().status === 0) return
  const raw = pkg.packageManager?.split('@')[1]
  const pnpmVersion = raw && /^[0-9A-Za-z.+-]+$/.test(raw) ? raw : 'latest'
  log('pnpm not found — attempting `corepack enable` automatically (bundled with Node 16–24)…')
  spawnSync('corepack enable', { shell: true, stdio: 'ignore' })
  spawnSync(`corepack prepare pnpm@${pnpmVersion} --activate`, { shell: true, stdio: 'ignore' })
  if (probe().status === 0) return
  fail(
    'pnpm is required. Enable it with `corepack enable` or install it with ' +
      '`npm install -g pnpm`, then re-run `npx agentroom`.',
  )
}

async function download(url, dest) {
  log(`Downloading AgentRoom v${VERSION} source…`)
  log(`  ${url}`)
  mkdirSync(dirname(dest), { recursive: true })
  // Write to a pid-suffixed .part in the SAME directory, then rename into place —
  // atomic, and two concurrent first runs can't interleave writes into one file.
  const part = `${dest}.${process.pid}.part`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok || !res.body) {
      fail(
        `Download failed (${res.status} ${res.statusText}). If the tag v${VERSION} is not on ` +
          `GitHub yet, use the git quickstart instead: ${QUICKSTART}`,
      )
    }
    const file = createWriteStream(part)
    const { Readable } = await import('node:stream')
    const { pipeline } = await import('node:stream/promises')
    await pipeline(Readable.fromWeb(res.body), file)
  } catch (err) {
    rmSync(part, { force: true })
    fail(
      `Could not download the source (are you offline?). ` +
        `Error: ${err?.cause?.code ?? err?.message ?? err}. ` +
        `You can always use the git quickstart instead: ${QUICKSTART}`,
    )
  }
  renameSync(part, dest)
}

/** Prefer Windows' bundled bsdtar: GNU tar (e.g. Git Bash's) mis-parses `C:\…` paths
 *  as remote `host:file` syntax. Elsewhere `tar` on PATH is fine. */
function findTar() {
  if (isWin) {
    const sys = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    if (existsSync(sys)) return sys
  }
  return 'tar'
}

/**
 * Extract the tarball into a scratch dir NEXT TO the destination (same filesystem —
 * `renameSync` cannot cross devices, and /tmp is a different device by default on
 * much of Linux), then move its top-level dir to appDir. tar runs with relative
 * paths from the tarball's own directory so no absolute Windows path reaches it.
 */
async function extract(tarball, appDir) {
  const tarBin = findTar()
  if (spawnSync(tarBin, ['--version'], { encoding: 'utf8' }).status !== 0) {
    fail(
      '`tar` was not found (it ships with Windows 10+, macOS, and Linux). Install tar, ' +
        `or use the git quickstart instead: ${QUICKSTART}`,
    )
  }
  const parent = dirname(appDir)
  mkdirSync(parent, { recursive: true })
  const scratch = mkdtempSync(join(parent, '.extract-'))
  try {
    // Keep tar's args relative wherever possible (cwd = the scratch's parent, and the
    // scratch sits directly under it): GNU tar mis-parses absolute `C:\…` arguments.
    // Only an external AGENTROOM_SOURCE_TARBALL still needs its absolute path.
    const sameDir = dirname(tarball) === parent
    const res = spawnSync(
      tarBin,
      ['-xzf', sameDir ? basename(tarball) : tarball, '-C', basename(scratch)],
      { cwd: parent, stdio: 'inherit' },
    )
    if (res.status !== 0) {
      fail(`Extraction failed — see tar output above. Git quickstart fallback: ${QUICKSTART}`)
    }
    const entries = await readdir(scratch)
    const top = entries.length === 1 ? join(scratch, entries[0]) : scratch
    if (!existsSync(join(top, 'scripts', 'launch.mjs'))) {
      fail(
        `The downloaded archive does not look like AgentRoom (no scripts/launch.mjs). ` +
          `Git quickstart fallback: ${QUICKSTART}`,
      )
    }
    rmSync(appDir, { recursive: true, force: true })
    renameSync(top, appDir) // same filesystem as scratch → atomic, no EXDEV
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function main() {
  checkNode()
  const cacheRoot = process.env.AGENTROOM_APP_CACHE ?? join(homedir(), '.agentroom', 'app')
  const appDir = join(cacheRoot, VERSION)
  const cached = existsSync(join(appDir, 'scripts', 'launch.mjs'))

  if (!cached || process.env.AGENTROOM_FORCE_FETCH === '1') {
    const override = process.env.AGENTROOM_SOURCE_TARBALL
    let tarball
    let downloaded = false
    if (override && /^http:\/\//i.test(override)) {
      fail('AGENTROOM_SOURCE_TARBALL must be an https:// URL or a local path (not http://).')
    }
    if (override && !/^https:\/\//i.test(override)) {
      tarball = resolve(override)
      if (!existsSync(tarball)) fail(`AGENTROOM_SOURCE_TARBALL not found: ${tarball}`)
      log(`Using local source tarball ${tarball}`)
    } else {
      tarball = join(cacheRoot, `agentroom-v${VERSION}.tar.gz`)
      await download(override ?? REPO_TARBALL, tarball)
      downloaded = true
    }
    await extract(tarball, appDir)
    if (downloaded) rmSync(tarball, { force: true }) // the extracted tree is the cache; don't litter
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
