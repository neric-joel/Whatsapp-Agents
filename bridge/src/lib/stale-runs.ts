import { getDb } from '@agentroom/db'

interface RecoverStaleRunsOptions {
  staleMs: number
  now?: () => number
  reason?: string
  logRecovered?: (runId: string) => void
}

interface StaleRunRow {
  id: string
}

export async function recoverStaleRuns({
  staleMs,
  now = Date.now,
  reason = 'stale: recovered by bridge',
  logRecovered,
}: RecoverStaleRunsOptions): Promise<number> {
  const db = getDb()
  const recoveredAt = new Date(now())
  const cutoff = new Date(recoveredAt.getTime() - staleMs).toISOString()
  // A run is stale only if its heartbeat is older than `staleMs`, OR it has no
  // heartbeat yet AND was claimed (`started_at`) more than `staleMs` ago. The age
  // guard on the NULL case is critical: a freshly-claimed run has `heartbeat_at IS
  // NULL` until its first heartbeat interval fires, so treating NULL as instantly
  // stale falsely fails healthy in-flight runs under load (observed in the C1 sweep).
  const staleRuns = db
    .prepare(
      `SELECT id FROM agent_runs
       WHERE status IN ('claimed', 'running')
         AND (heartbeat_at < ? OR (heartbeat_at IS NULL AND started_at < ?))`,
    )
    .all(cutoff, cutoff) as StaleRunRow[]

  let recovered = 0

  for (const run of staleRuns) {
    // Status guard: only fail a run that is STILL claimed/running. Between the
    // SELECT above and this UPDATE the worker may have completed/cancelled it — the
    // guard makes recovery idempotent and prevents clobbering a terminal state
    // (e.g. completed → failed).
    const updated = db
      .prepare(
        `UPDATE agent_runs
         SET status = 'failed', error_message = ?, completed_at = ?
         WHERE id = ? AND status IN ('claimed', 'running')
         RETURNING id`,
      )
      .get(reason, recoveredAt.toISOString(), run.id) as StaleRunRow | undefined
    if (updated) {
      recovered += 1
      logRecovered?.(run.id)
    }
  }

  return recovered
}
