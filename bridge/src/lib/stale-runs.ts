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
  const { data: staleRuns } = await supabase
    .from('agent_runs')
    .select('id')
    .in('status', ['claimed', 'running'])
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)

  let recovered = 0

  for (const run of (staleRuns ?? []) as StaleRunRow[]) {
    await supabase
      .from('agent_runs')
      .update({
        status: 'failed',
        error_message: reason,
        completed_at: recoveredAt.toISOString(),
      })
      .eq('id', run.id)
    recovered += 1
    logRecovered?.(run.id)
  }

  return recovered
}
