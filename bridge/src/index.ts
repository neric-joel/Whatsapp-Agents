import 'dotenv/config'

import { getDb, nowIso } from '@agentroom/db'

import { loadBridgeEnv } from './lib/env.js'
import { errorTrackingEnabled } from './lib/error-tracking.js'
import { createHealthServer } from './lib/health-server.js'
import { writeHeartbeats } from './lib/heartbeat.js'
import { log } from './lib/logger.js'
import { recoverStaleRuns } from './lib/stale-runs.js'
import { processRun } from './workers/run-worker.js'

// Fail fast on a bad environment, naming the offending var(s).
const env = loadBridgeEnv()
const POLL_MS = env.BRIDGE_POLL_INTERVAL_MS
const MAX_CONC = env.BRIDGE_MAX_CONCURRENT_RUNS
const HEARTBEAT_MS = env.BRIDGE_HEARTBEAT_INTERVAL_MS
const STALE_MS = env.BRIDGE_STALE_RUN_TIMEOUT_MS
const STALE_SWEEP_MS = Math.max(HEARTBEAT_MS, Math.min(STALE_MS, 30000))
const HEALTH_PORT = env.BRIDGE_HEALTH_PORT
const HEALTH_HOST = env.BRIDGE_HEALTH_HOST

// runId -> its AbortController, so shutdown can abort in-flight runs (kill child CLIs).
const activeRuns = new Map<string, AbortController>()
const startedAt = Date.now()
let lastPollAt: string | null = null

async function pollOnce() {
  lastPollAt = new Date().toISOString()
  if (activeRuns.size >= MAX_CONC) return
  log('debug', 'poll.start')
  const db = getDb()
  const runs = db
    .prepare('SELECT id FROM agent_runs WHERE status = ? LIMIT ?')
    .all('queued', MAX_CONC - activeRuns.size) as { id: string }[]
  if (!runs || runs.length === 0) {
    log('debug', 'poll.empty')
    return
  }
  log('info', 'poll.found', { count: runs.length })
  for (const run of runs) {
    const id = run.id as string
    if (activeRuns.has(id)) continue
    const controller = new AbortController()
    activeRuns.set(id, controller)
    processRun(id, { signal: controller.signal })
      .catch((err) =>
        log('error', 'run.process.error', {
          run_id: id,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      .finally(() => activeRuns.delete(id))
  }
}

async function recoverStaleRunsOnce(reason: string) {
  const count = await recoverStaleRuns({
    staleMs: STALE_MS,
    reason,
    logRecovered: (runId) => {
      log('warn', 'run.stale.recovered', { run_id: runId })
    },
  })
  if (count > 0) log('warn', 'run.stale.recovery.complete', { count })
}

async function sendHeartbeat() {
  const runIds = [...activeRuns.keys()]
  if (writeHeartbeats(getDb(), runIds, nowIso()) === 0) return
  for (const runId of runIds) {
    log('debug', 'heartbeat.sent', { run_id: runId })
  }
}

async function countQueuedRuns(): Promise<number | null> {
  try {
    const db = getDb()
    const row = db
      .prepare('SELECT count(*) AS count FROM agent_runs WHERE status = ?')
      .get('queued') as { count: number } | undefined
    return row?.count ?? 0
  } catch {
    return null
  }
}

async function main() {
  log('info', 'bridge.start', {
    poll_interval_ms: POLL_MS,
    max_concurrent: MAX_CONC,
    stale_sweep_ms: STALE_SWEEP_MS,
    health_port: HEALTH_PORT,
    error_tracking: errorTrackingEnabled,
  })

  const healthServer = createHealthServer(HEALTH_PORT, {
    workerId: env.BRIDGE_WORKER_ID,
    startedAt,
    getActiveRuns: () => activeRuns.size,
    getQueuedRuns: countQueuedRuns,
    getLastPollAt: () => lastPollAt,
  })
  if (healthServer) {
    // Surface a bind failure (e.g. EADDRINUSE) instead of failing silently — the
    // container HEALTHCHECK would otherwise restart-loop with no diagnostic.
    healthServer.on('error', (err: NodeJS.ErrnoException) =>
      log('error', 'health.listen.error', { port: HEALTH_PORT, error: err.message }),
    )
    healthServer.listen(HEALTH_PORT, HEALTH_HOST, () =>
      log('info', 'health.listening', { host: HEALTH_HOST, port: HEALTH_PORT }),
    )
  }

  await recoverStaleRunsOnce('stale: recovered on startup')
  const pollTimer = setInterval(() => {
    pollOnce().catch((err) =>
      log('error', 'poll.error', { error: err instanceof Error ? err.message : String(err) }),
    )
  }, POLL_MS)
  const heartbeatTimer = setInterval(() => {
    sendHeartbeat().catch((err) =>
      log('error', 'heartbeat.error', { error: err instanceof Error ? err.message : String(err) }),
    )
  }, HEARTBEAT_MS)
  const staleTimer = setInterval(() => {
    recoverStaleRunsOnce('stale: recovered by periodic sweep').catch((err) =>
      log('error', 'stale.recovery.error', {
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }, STALE_SWEEP_MS)

  // Graceful shutdown on Ctrl-C (SIGINT) / SIGTERM: stop the loops so no new runs are claimed,
  // then abort in-flight runs — each adapter kills its child CLI (SIGTERM, then a forced kill-tree
  // after a 2s grace) and the run finalizes `cancelled` rather than being left `running` for the
  // next startup's stale sweep. The exit timer is a .unref'd CEILING: a CLI that exits on SIGTERM
  // lets the process exit immediately, while a SIGTERM-ignoring CLI gets the full kill timeline
  // (~3s) before a forced exit, so a child tree is not orphaned on shutdown.
  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    const inFlight = activeRuns.size
    log('info', 'bridge.shutdown', { signal, active_runs: inFlight })
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
    clearInterval(staleTimer)
    healthServer?.close()
    for (const controller of activeRuns.values()) controller.abort()
    setTimeout(() => process.exit(0), inFlight > 0 ? 3000 : 100).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  log('error', 'bridge.fatal', { error: err instanceof Error ? err.message : String(err) })
  process.exitCode = 1
})
