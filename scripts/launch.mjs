#!/usr/bin/env node
/**
 * AgentRoom production launcher — one cross-platform `pnpm start`.
 *
 * This is what END USERS run. It ships the BUILT app (no `next dev`): it installs deps
 * if missing, builds the web app once (`next build`), then starts the production web
 * server (`next start`) and the bridge daemon (non-watch), waits until
 * http://localhost:3000 answers, and opens the browser. Ctrl-C (or either child dying)
 * tears the whole stack down.
 *
 * Why a Node script instead of a shell launcher: the old `start-agentroom.bat` only
 * existed to paper over `next dev` instability — killing stale port-3000 listeners,
 * wiping `.next`, and reaping zombie `tsx watch` processes. A built app started fresh each
 * launch needs none of that, and one small dependency-light script runs identically on
 * Windows, macOS and Linux. Contributors who want hot-reload still use `pnpm dev`.
 *
 * Env:
 *   AGENTROOM_SKIP_BUILD=1   reuse the existing `.next` build (skip `next build`) — handy
 *                            for fast restarts and the stability harness; off by default.
 *   AGENTROOM_NO_OPEN=1      don't open a browser (headless / CI / evidence runs).
 *   PORT                     web port (default 3000); the readiness probe follows it.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT = Number(process.env.PORT ?? 3000)
const URL = `http://localhost:${PORT}`
const READY_PROBE = `${URL}/api/health`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const isWin = process.platform === 'win32'

/** Tagged, timestamped line so combined web+bridge output is readable + greppable. */
function emit(tag, line) {
  const text = line.toString().replace(/\s+$/, '')
  if (text) process.stdout.write(`[${new Date().toISOString()}] [${tag}] ${text}\n`)
}

/** Run a command to completion; resolve with its exit code. Inherits stdio (live output). */
function run(label, command) {
  emit('launch', `→ ${command}`)
  return new Promise((resolve) => {
    const child = spawn(command, { cwd: ROOT, shell: true, stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? 0))
    child.on('error', (err) => {
      emit('launch', `${label} failed to start: ${err.message}`)
      resolve(1)
    })
  })
}

/**
 * Start a long-lived child. On POSIX it leads its own process group (`detached`) so we can
 * signal the whole tree on shutdown; on Windows we use `taskkill /T` instead. Output is
 * piped and re-emitted with a tag.
 */
function startService(tag, command) {
  const child = spawn(command, {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: !isWin,
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  child.stdout?.on('data', (d) => emit(tag, d))
  child.stderr?.on('data', (d) => emit(tag, d))
  return child
}

/** Kill a child and its whole subtree (next/node grandchildren), cross-platform. */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM')
    }
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

function openBrowser() {
  if (process.env.AGENTROOM_NO_OPEN === '1') return
  const cmd = isWin
    ? `start "" "${URL}"`
    : process.platform === 'darwin'
      ? `open "${URL}"`
      : `xdg-open "${URL}"`
  spawn(cmd, { shell: true, stdio: 'ignore' }).on('error', () => {})
}

async function waitForReady(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(READY_PROBE)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await sleep(1000)
  }
  return false
}

async function main() {
  emit('launch', `AgentRoom starting (${process.platform}, node ${process.version}) — port ${PORT}`)

  // 1. Install deps on first run.
  if (!existsSync(join(ROOT, 'node_modules'))) {
    emit('launch', 'node_modules missing — installing dependencies (first run)…')
    if ((await run('install', 'pnpm install')) !== 0) {
      emit('launch', 'pnpm install failed. Install Node 22.13+ and run `corepack enable`.')
      process.exit(1)
    }
  }

  // 2. Build the web app (skippable for fast restarts). Building each launch keeps `.next`
  //    fresh, which is precisely why no cache-clearing hack is needed.
  if (process.env.AGENTROOM_SKIP_BUILD === '1') {
    emit('launch', 'AGENTROOM_SKIP_BUILD=1 — reusing existing build')
  } else {
    emit('launch', 'Building web app (next build)…')
    if ((await run('build', 'pnpm --filter web build')) !== 0) {
      emit('launch', 'Build failed — see output above.')
      process.exit(1)
    }
  }

  // 3. Start the production web server + the bridge (both non-watch).
  emit('launch', 'Starting web (next start) + bridge…')
  const web = startService('web', 'pnpm --filter web start')
  const bridge = startService('bridge', 'pnpm --filter bridge start')

  let shuttingDown = false
  const shutdown = (reason, code = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    emit('launch', `Shutting down (${reason})…`)
    killTree(web)
    killTree(bridge)
    setTimeout(() => process.exit(code), 500).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  // If either service dies on its own, bring the whole stack down rather than limp along.
  web.on('exit', (c) => shutdown(`web exited (${c})`, c ?? 1))
  bridge.on('exit', (c) => shutdown(`bridge exited (${c})`, c ?? 1))

  // 4. Wait for readiness, then open the browser.
  emit('launch', `Waiting for ${READY_PROBE}…`)
  if (await waitForReady()) {
    emit('launch', `Ready at ${URL} — opening browser.`)
    openBrowser()
    emit(
      'launch',
      'AgentRoom is running. Open Connections (plug icon) to add your CLIs. Ctrl-C to stop.',
    )
  } else {
    emit('launch', `Web server did not become ready at ${READY_PROBE} within the timeout.`)
    shutdown('readiness-timeout', 1)
  }
}

main().catch((err) => {
  emit('launch', `Fatal: ${err?.stack ?? err}`)
  process.exit(1)
})
