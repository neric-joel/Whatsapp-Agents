#!/usr/bin/env node
/**
 * `npx agentroom` — the published entry point.
 *
 * This package deliberately ships NO app code: the bin you are reading downloads the
 * AgentRoom source for the exact commit this package was published from, caches it under
 * `~/.agentroom/app/X.Y.Z/`, and runs the repo's own launcher (`scripts/launch.mjs` —
 * install → build → start web + bridge → open the browser). That keeps the npm artifact
 * tiny and auditable, and means `npx agentroom` does exactly what the README's
 * `git clone && pnpm start` quickstart does — minus the clone.
 *
 * First run is honest work: it downloads the source (~a few MB), installs
 * dependencies, and builds the web app — expect a few minutes. Later runs reuse the
 * cache and start quickly (launch.mjs rebuilds unless AGENTROOM_SKIP_BUILD=1).
 *
 * What it downloads is pinned, not named: `release.yml` writes the exact commit the npm
 * artifact was cut from, plus the SHA-256 of that commit's GitHub source archive, into
 * this package's own `package.json` (`agentroom.source`) at publish time. The bin fetches
 * `/archive/<commit>.tar.gz` — a commit id cannot be force-moved the way a `vX.Y.Z` tag
 * can — and refuses to extract bytes whose digest does not match. Nothing here trusts a
 * tag any more.
 *
 * Env:
 *   AGENTROOM_SOURCE_TARBALL  https:// URL or local path of a source tarball to use
 *                             instead of the recorded source (used for pre-tag testing,
 *                             where the release doesn't exist on GitHub yet). Plain
 *                             http:// is refused. The recorded digest describes the
 *                             recorded commit, so it cannot apply to an operator-supplied
 *                             tarball: this path is NOT integrity-verified and says so.
 *   AGENTROOM_ALLOW_UNVERIFIED_SOURCE=1
 *                             download the `v<version>` TAG archive with no digest check,
 *                             when this copy of the bin has no recorded source (i.e. it is
 *                             a git checkout, not a published artifact — in a checkout,
 *                             prefer `pnpm start`). It is not an escape hatch for a digest
 *                             MISMATCH: a mismatch always fails.
 *   AGENTROOM_APP_CACHE       override the cache dir (default ~/.agentroom/app).
 *   AGENTROOM_FORCE_FETCH=1   re-download even if the version is already cached.
 *   (launch.mjs env also applies: AGENTROOM_NO_OPEN, AGENTROOM_SKIP_BUILD, PORT.)
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
// Hard-coded origin+repo: the only value ever interpolated into a source URL is a
// charset-validated commit id from this package's own manifest (see resolveSource).
const REPO_ARCHIVE = 'https://github.com/neric-joel/Whatsapp-Agents/archive'
const TAG_TARBALL = `${REPO_ARCHIVE}/refs/tags/v${VERSION}.tar.gz`
const QUICKSTART = 'https://github.com/neric-joel/Whatsapp-Agents#quickstart'
const COMMIT_RE = /^[0-9a-f]{40}$/
const SHA256_RE = /^[0-9a-f]{64}$/
const MIN_NODE = [22, 13, 0]
const isWin = process.platform === 'win32'

const log = (msg) => console.log(`[agentroom] ${msg}`)
// stderr, so "this source was not verified" survives a piped/quiet stdout.
const warn = (msg) => console.error(`[agentroom] WARNING: ${msg}`)
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
function ensurePnpm(trustedCwd) {
  // Fixed command strings; the only interpolated value is the pnpm version from this
  // package's OWN published manifest, validated to a version-safe charset. cwd is
  // pinned to the app cache because cmd.exe resolves bare names from the CURRENT
  // directory before PATH — `npx agentroom` inside an untrusted folder must never
  // execute a planted pnpm.cmd/corepack.cmd from that folder.
  const opts = { shell: true, cwd: trustedCwd }
  const probe = () => spawnSync('pnpm --version', { ...opts, encoding: 'utf8' })
  if (probe().status === 0) return
  const raw = pkg.packageManager?.split('@')[1]
  const pnpmVersion = raw && /^[0-9A-Za-z.+-]+$/.test(raw) ? raw : 'latest'
  log('pnpm not found — attempting `corepack enable` automatically (bundled with Node 16–24)…')
  spawnSync('corepack enable', { ...opts, stdio: 'ignore' })
  spawnSync(`corepack prepare pnpm@${pnpmVersion} --activate`, { ...opts, stdio: 'ignore' })
  if (probe().status === 0) return
  fail(
    'pnpm is required. Enable it with `corepack enable` or install it with ' +
      '`npm install -g pnpm`, then re-run `npx agentroom`.',
  )
}

/**
 * Where the source comes from, and what it must hash to.
 *
 * `agentroom.source` is written into the PUBLISHED package.json by release.yml's
 * publish-npm job (it is never committed), which refuses to publish without it. So a
 * published artifact always carries it and a git checkout never does — those are the two
 * cases below, and neither of them is "skip the check quietly".
 */
function resolveSource() {
  const recorded = pkg.agentroom?.source
  if (recorded === undefined || recorded === null) {
    if (process.env.AGENTROOM_ALLOW_UNVERIFIED_SOURCE === '1') {
      warn(
        `AGENTROOM_ALLOW_UNVERIFIED_SOURCE=1 — downloading the mutable v${VERSION} tag ` +
          'archive with NO integrity verification.',
      )
      return { url: TAG_TARBALL, sha256: null }
    }
    fail(
      `This copy of the agentroom bin records no source commit or digest, so what it ` +
        `would download, build and run cannot be verified. Every published release ` +
        `records both, so this is almost certainly a git checkout — in a checkout run ` +
        `\`pnpm start\` instead. To fetch the v${VERSION} tag archive anyway, ` +
        `unverified, set AGENTROOM_ALLOW_UNVERIFIED_SOURCE=1.`,
    )
  }
  // Malformed is tampering or a broken release, never a checkout — no opt-out here.
  if (!COMMIT_RE.test(recorded?.commit ?? '') || !SHA256_RE.test(recorded?.sha256 ?? '')) {
    fail(
      `The recorded source pin in this package is malformed (commit=${recorded?.commit}, ` +
        `sha256=${recorded?.sha256}). Refusing to download anything. Re-install ` +
        `agentroom, or use the git quickstart: ${QUICKSTART}`,
    )
  }
  return { url: `${REPO_ARCHIVE}/${recorded.commit}.tar.gz`, sha256: recorded.sha256 }
}

// Exact hosts, not a suffix rule: `/archive/…` resolves in exactly one hop to codeload,
// and suffix matching would admit `.github.com` (empty leading label) plus
// raw/objects.githubusercontent.com, which serve arbitrary user-supplied content — the
// digest makes that harmless, but AGENTROOM_ALLOW_UNVERIFIED_SOURCE=1 has no digest.
// If GitHub ever moves archive downloads to another host this fails closed; the error
// names the git quickstart, and the fix is a bin release.
const GITHUB_ARCHIVE_HOSTS = new Set(['github.com', 'codeload.github.com'])

/**
 * @param {{ sha256: string | null, gitHubOnly: boolean }} opts
 *   sha256      expected digest of the bytes, or null when the caller is an explicitly
 *               operator-supplied source (AGENTROOM_SOURCE_TARBALL / the unverified opt-in).
 *   gitHubOnly  the URL came from this file's own constants, so the redirect chain must
 *               stay inside GitHub. False for an operator-supplied URL, which may be anywhere.
 */
async function download(url, dest, opts) {
  log(`Downloading AgentRoom v${VERSION} source…`)
  log(`  ${url}`)
  mkdirSync(dirname(dest), { recursive: true })
  // Write to a pid-suffixed .part in the SAME directory, then rename into place —
  // atomic, and two concurrent first runs can't interleave writes into one file.
  const part = `${dest}.${process.pid}.part`
  try {
    const res = await fetch(url, { redirect: 'follow' })
    // `redirect: 'follow'` resolves the chain silently, so constrain where it LANDED, not
    // just what we asked for: an https:// request that ends on plain http:// (GitHub's
    // archive redirects to codeload) would hand a network attacker the bytes we are about
    // to build and execute. res.url is the post-redirect URL.
    //
    // Only the LANDING url is checked — undici exposes no per-hop callback, so an
    // intermediate http:// hop is invisible here. release.yml's own fetch of the same
    // archive is stricter (`curl --proto-redir '=https'`, every hop); on this side the
    // digest is what catches bytes that took a detour.
    let finalUrl = null
    try {
      finalUrl = new URL(res.url)
    } catch {
      fail(`Download redirected to a URL that cannot be parsed (${res.url}). Refusing it.`)
    }
    if (finalUrl.protocol !== 'https:') {
      fail(
        `Download was redirected off TLS (${url} → ${res.url}). Refusing to fetch source ` +
          `over ${finalUrl.protocol}. Git quickstart fallback: ${QUICKSTART}`,
      )
    }
    if (opts.gitHubOnly && !GITHUB_ARCHIVE_HOSTS.has(finalUrl.hostname)) {
      fail(
        `Download was redirected off GitHub (${url} → ${res.url}). Refusing it. ` +
          `Git quickstart fallback: ${QUICKSTART}`,
      )
    }
    if (!res.ok || !res.body) {
      fail(
        `Download failed (${res.status} ${res.statusText}). If this release's source is ` +
          `not on GitHub, use the git quickstart instead: ${QUICKSTART}`,
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
  // Verify BEFORE the rename: unverified bytes must never land at the cache path that
  // extract() reads, not even briefly.
  if (opts.sha256) {
    const actual = createHash('sha256').update(readFileSync(part)).digest('hex')
    if (actual !== opts.sha256) {
      rmSync(part, { force: true })
      fail(
        `Source integrity check FAILED — the download does not match the digest this ` +
          `release recorded.\n  expected sha256 ${opts.sha256}\n  actual   sha256 ${actual}\n` +
          `Nothing was extracted and nothing was run. Either the source was tampered with, ` +
          `or GitHub regenerated this archive with different compression (it did that once, ` +
          `in 2023, moving every checksum — see ADR-0014): check whether EVERY published ` +
          `version fails this way or only yours. Do not retry blindly. Use the git ` +
          `quickstart meanwhile (${QUICKSTART}) and report it at ` +
          `https://github.com/neric-joel/Whatsapp-Agents/issues`,
      )
    }
    log(`Source integrity verified (sha256 ${opts.sha256}).`)
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
  const parent = dirname(appDir)
  mkdirSync(parent, { recursive: true })
  const tarBin = findTar()
  // cwd pinned: Windows resolves bare names from the current directory before PATH.
  if (spawnSync(tarBin, ['--version'], { encoding: 'utf8', cwd: parent }).status !== 0) {
    fail(
      '`tar` was not found (it ships with Windows 10+, macOS, and Linux). Install tar, ' +
        `or use the git quickstart instead: ${QUICKSTART}`,
    )
  }
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
    try {
      rmSync(appDir, { recursive: true, force: true })
    } catch (err) {
      // Windows throws EBUSY/EPERM when a previous AgentRoom instance still runs
      // from this cache — deleting it out from under a live app helps no one.
      if (err?.code === 'EBUSY' || err?.code === 'EPERM') {
        fail(
          `The cached app at ${appDir} is in use (is AgentRoom already running?). ` +
            'Stop it, then re-run `npx agentroom`.',
        )
      }
      throw err
    }
    renameSync(top, appDir) // same filesystem as scratch → atomic, no EXDEV
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** True when `pid` names a process that still exists — signal 0 checks for existence
 *  without delivering anything. EPERM means it exists but belongs to another user. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

/** Best-effort sweep of leftovers from hard-killed runs (`.extract-*` scratch dirs
 *  and `*.part` partial downloads use random/pid names, so the OS never reclaims
 *  them and a later run never reuses them).
 *
 *  A `*.part` is only an orphan once the process that named it is gone. This used to
 *  delete every one of them, so a second `npx agentroom` started while the first was
 *  still downloading removed the first's in-flight file — and the victim then died on
 *  `readFileSync(part)` with a raw ENOENT. `.part` names carry their owner's pid
 *  precisely so this can be told apart; the old comment claimed concurrent runs "can't
 *  interleave writes into one file", which was true and beside the point. */
function sweepOrphans(cacheRoot) {
  try {
    for (const name of readdirSync(cacheRoot)) {
      if (name.startsWith('.extract-')) {
        rmSync(join(cacheRoot, name), { recursive: true, force: true })
        continue
      }
      if (!name.endsWith('.part')) continue
      // `<file>.<pid>.part` — keep it if that pid is still running. An unparseable name
      // predates this scheme, so it cannot belong to a live download: sweep it.
      const owner = Number(name.split('.').at(-2))
      if (Number.isInteger(owner) && owner > 0 && pidAlive(owner)) continue
      rmSync(join(cacheRoot, name), { recursive: true, force: true })
    }
  } catch {
    /* cache root may not exist yet — nothing to sweep */
  }
}

async function main() {
  checkNode()
  // `?.trim() ||` (not `??`): an empty-but-set AGENTROOM_APP_CACHE must fall back to
  // the default, not root the cache (and its rmSync targets) in the invocation cwd.
  const cacheRoot = process.env.AGENTROOM_APP_CACHE?.trim() || join(homedir(), '.agentroom', 'app')
  const appDir = join(cacheRoot, VERSION)
  sweepOrphans(cacheRoot)
  const cached = existsSync(join(appDir, 'scripts', 'launch.mjs'))

  if (!cached || process.env.AGENTROOM_FORCE_FETCH === '1') {
    const override = process.env.AGENTROOM_SOURCE_TARBALL
    let tarball
    let downloaded = false
    if (override && /^http:\/\//i.test(override)) {
      fail('AGENTROOM_SOURCE_TARBALL must be an https:// URL or a local path (not http://).')
    }
    // Above the local-path/https split, so BOTH override branches say it: the recorded
    // digest describes the recorded commit and cannot describe an operator's own tarball.
    // Substituting the source is deliberate; doing it silently is not.
    if (override) {
      warn('AGENTROOM_SOURCE_TARBALL is set — this source is NOT integrity-verified.')
    }
    if (override && !/^https:\/\//i.test(override)) {
      tarball = resolve(override)
      if (!existsSync(tarball)) fail(`AGENTROOM_SOURCE_TARBALL not found: ${tarball}`)
      log(`Using local source tarball ${tarball}`)
    } else {
      tarball = join(cacheRoot, `agentroom-v${VERSION}.tar.gz`)
      if (override) {
        await download(override, tarball, { sha256: null, gitHubOnly: false })
      } else {
        const source = resolveSource()
        await download(source.url, tarball, { sha256: source.sha256, gitHubOnly: true })
      }
      downloaded = true
    }
    await extract(tarball, appDir)
    if (downloaded) rmSync(tarball, { force: true }) // the extracted tree is the cache; don't litter
    log(`Source ready at ${appDir}`)
    log('First run installs dependencies and builds the app — this takes a few minutes.')
  } else {
    log(`Using cached AgentRoom v${VERSION} at ${appDir}`)
  }

  ensurePnpm(appDir)

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
