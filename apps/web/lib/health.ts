import { createSupabaseServiceClient } from './supabase/server'

type DbHealth = { status: 'up' | 'down' | 'unknown'; latency_ms?: number }

const DB_CHECK_TIMEOUT_MS = 2000

/**
 * Best-effort database readiness check for /api/health. Runs a tiny HEAD count
 * against `agents` (RLS-safe: a count, no rows) and is bounded by a short timeout
 * so a hung/unreachable DB never blocks the liveness response. Never throws.
 */
export async function checkDatabase(): Promise<DbHealth> {
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const supabase = createSupabaseServiceClient()
    const query = supabase.from('agents').select('id', { head: true, count: 'exact' })
    // The timeout RESOLVES to a sentinel (never rejects) so no floating rejection
    // survives the race; the timer is always cleared in `finally`.
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), DB_CHECK_TIMEOUT_MS)
    })
    const result = (await Promise.race([query, timeout])) as 'timeout' | { error: unknown }
    if (result === 'timeout' || result.error) return { status: 'down' }
    return { status: 'up', latency_ms: Date.now() - startedAt }
  } catch {
    return { status: 'down' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
