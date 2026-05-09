import 'dotenv/config'
import { log } from './lib/logger.js'
import { createServiceClient } from './lib/supabase.js'
import { processRun } from './workers/run-worker.js'

const WORKER_ID    = process.env.BRIDGE_WORKER_ID               ?? 'bridge-local-1'
const POLL_MS      = +(process.env.BRIDGE_POLL_INTERVAL_MS      ?? 2000)
const MAX_CONC     = +(process.env.BRIDGE_MAX_CONCURRENT_RUNS   ?? 3)
const HEARTBEAT_MS = +(process.env.BRIDGE_HEARTBEAT_INTERVAL_MS ?? 5000)
const STALE_MS     = +(process.env.BRIDGE_STALE_RUN_TIMEOUT_MS  ?? 60000)

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
      .catch(err => log('error', 'run.process.error', { run_id: id, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => activeRuns.delete(id))
  }
}

async function recoverStaleRuns() {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - STALE_MS).toISOString()
  const { data: staleRuns } = await supabase
    .from('agent_runs')
    .select('id')
    .in('status', ['claimed', 'running'])
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)

  for (const run of staleRuns ?? []) {
    const runId = run.id as string
    await supabase
      .from('agent_runs')
      .update({ status: 'failed', error_message: 'stale: recovered on startup' })
      .eq('id', runId)
    log('warn', 'run.stale.recovered', { run_id: runId })
  }
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
  log('info', 'bridge.start', { poll_interval_ms: POLL_MS, max_concurrent: MAX_CONC })
  await recoverStaleRuns()
  setInterval(() => { pollOnce().catch(err => log('error', 'poll.error', { error: err instanceof Error ? err.message : String(err) })) }, POLL_MS)
  setInterval(() => { sendHeartbeat().catch(err => log('error', 'heartbeat.error', { error: err instanceof Error ? err.message : String(err) })) }, HEARTBEAT_MS)
}

main().catch(err => {
  log('error', 'bridge.fatal', { error: err instanceof Error ? err.message : String(err) })
  process.exitCode = 1
})
