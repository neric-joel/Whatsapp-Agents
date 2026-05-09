import 'dotenv/config'
import { createServiceClient } from './lib/supabase.js'
import { processRun } from './workers/run-worker.js'

const WORKER_ID    = process.env.BRIDGE_WORKER_ID               ?? 'bridge-local-1'
const POLL_MS      = +(process.env.BRIDGE_POLL_INTERVAL_MS      ?? 2000)
const MAX_CONC     = +(process.env.BRIDGE_MAX_CONCURRENT_RUNS   ?? 3)
const HEARTBEAT_MS = +(process.env.BRIDGE_HEARTBEAT_INTERVAL_MS ?? 5000)
const STALE_MS     = +(process.env.BRIDGE_STALE_RUN_TIMEOUT_MS  ?? 60000)

console.log(`Bridge Daemon starting... worker=${WORKER_ID} poll=${POLL_MS}ms`)

const activeRuns = new Set<string>()

async function pollOnce() {
  if (activeRuns.size >= MAX_CONC) return
  const supabase = createServiceClient()
  const { data: runs } = await supabase
    .from('agent_runs')
    .select('id')
    .eq('status', 'queued')
    .limit(MAX_CONC - activeRuns.size)
  if (!runs || runs.length === 0) return
  for (const run of runs) {
    const id = run.id as string
    if (activeRuns.has(id)) continue
    activeRuns.add(id)
    processRun(id)
      .catch(err => console.error(`[BRIDGE] run=${id} error:`, err))
      .finally(() => activeRuns.delete(id))
  }
}

async function recoverStaleRuns() {
  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - STALE_MS).toISOString()
  await supabase
    .from('agent_runs')
    .update({ status: 'queued', worker_id: null, started_at: null })
    .in('status', ['claimed', 'running'])
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)
}

async function sendHeartbeat() {
  if (activeRuns.size === 0) return
  const supabase = createServiceClient()
  await supabase
    .from('agent_runs')
    .update({ heartbeat_at: new Date().toISOString() })
    .in('id', [...activeRuns])
}

recoverStaleRuns().catch(console.error)
setInterval(() => { pollOnce().catch(console.error) }, POLL_MS)
setInterval(() => { sendHeartbeat().catch(console.error) }, HEARTBEAT_MS)
