import type { SupabaseClient } from '@supabase/supabase-js'

interface RecoverStaleRunsOptions {
  supabase: SupabaseClient
  staleMs: number
  now?: () => number
  reason?: string
  logRecovered?: (runId: string) => void
}

interface StaleRunRow {
  id: string
}

export async function recoverStaleRuns({
  supabase,
  staleMs,
  now = Date.now,
  reason = 'stale: recovered by bridge',
  logRecovered,
}: RecoverStaleRunsOptions): Promise<number> {
  const recoveredAt = new Date(now())
  const cutoff = new Date(recoveredAt.getTime() - staleMs).toISOString()
  // A run is stale only if its heartbeat is older than `staleMs`, OR it has no
  // heartbeat yet AND was claimed (`started_at`) more than `staleMs` ago. The age
  // guard on the NULL case is critical: a freshly-claimed run has `heartbeat_at IS
  // NULL` until its first heartbeat interval fires, so treating NULL as instantly
  // stale falsely fails healthy in-flight runs under load (observed in the C1 sweep).
  const { data: staleRuns } = await supabase
    .from('agent_runs')
    .select('id')
    .in('status', ['claimed', 'running'])
    .or(`heartbeat_at.lt.${cutoff},and(heartbeat_at.is.null,started_at.lt.${cutoff})`)

  let recovered = 0

  for (const run of (staleRuns ?? []) as StaleRunRow[]) {
    // Status guard: only fail a run that is STILL claimed/running. Between the
    // SELECT above and this UPDATE the worker may have completed/cancelled it — the
    // guard makes recovery idempotent and prevents clobbering a terminal state
    // (e.g. completed → failed).
    const { data: updated } = await supabase
      .from('agent_runs')
      .update({
        status: 'failed',
        error_message: reason,
        completed_at: recoveredAt.toISOString(),
      })
      .eq('id', run.id)
      .in('status', ['claimed', 'running'])
      .select('id')
    if (updated && updated.length > 0) {
      recovered += 1
      logRecovered?.(run.id)
    }
  }

  return recovered
}
