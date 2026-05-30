import 'dotenv/config'

import { loadBridgeEnv } from './lib/env.js'
import { log } from './lib/logger.js'
import { recoverStaleRuns } from './lib/stale-runs.js'
import { createServiceClient } from './lib/supabase.js'
import { processRun } from './workers/run-worker.js'

// Fail fast on a bad environment, naming the offending var(s).
const env = loadBridgeEnv()
const POLL_MS = env.BRIDGE_POLL_INTERVAL_MS
const MAX_CONC = env.BRIDGE_MAX_CONCURRENT_RUNS
const HEARTBEAT_MS = env.BRIDGE_HEARTBEAT_INTERVAL_MS
const STALE_MS = env.BRIDGE_STALE_RUN_TIMEOUT_MS
const STALE_SWEEP_MS = Math.max(HEARTBEAT_MS, Math.min(STALE_MS, 30000))

const activeRuns = new Set<string>()

async function pollOnce() {
  if (activeRuns.size >= MAX_CONC) return
  log('debug', 'poll.start')
  const supabase = createServiceClient()
  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('status', 'queued')
    .limit(MAX_CONC - activeRuns.size)
  if (!runs || runs.length === 0) {
    log('debug', 'poll.empty')
    return
  }
  log('info', 'poll.found', { count: runs.length })
  for (const run of runs) {
    const id = run.id as string
    if (activeRuns.has(id)) continue
    activeRuns.add(id)
    processRun(id)
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
  const supabase = createServiceClient()
  const count = await recoverStaleRuns({
    supabase,
    staleMs: STALE_MS,
    reason,
    logRecovered: (runId) => {
      log('warn', 'run.stale.recovered', { run_id: runId })
    },
  })
  if (count > 0) log('warn', 'run.stale.recovery.complete', { count })
}

async function sendHeartbeat() {
  if (activeRuns.size === 0) return
  const runIds = [...activeRuns]
  const supabase = createServiceClient()
  await supabase
    .from('agent_runs')
    .update({ heartbeat_at: new Date().toISOString() })
    .in('id', runIds)
  for (const runId of runIds) {
    log('debug', 'heartbeat.sent', { run_id: runId })
  }
}

async function main() {
  log('info', 'bridge.start', {
    poll_interval_ms: POLL_MS,
    max_concurrent: MAX_CONC,
    stale_sweep_ms: STALE_SWEEP_MS,
  })
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

  // Graceful shutdown for `docker stop` (SIGTERM) / Ctrl-C (SIGINT): stop the loops
  // so no new runs are claimed, then exit. Any in-flight run is re-claimed by a
  // worker via stale-run recovery on the next startup.
  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    log('info', 'bridge.shutdown', { signal, active_runs: activeRuns.size })
    clearInterval(pollTimer)
    clearInterval(heartbeatTimer)
    clearInterval(staleTimer)
    setTimeout(() => process.exit(0), 100).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err) => {
  log('error', 'bridge.fatal', { error: err instanceof Error ? err.message : String(err) })
  process.exitCode = 1
})
