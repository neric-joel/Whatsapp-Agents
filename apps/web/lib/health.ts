import { getDb } from '@agentroom/db'

type DbHealth = { status: 'up' | 'down' | 'unknown'; latency_ms?: number }

/**
 * Best-effort database readiness check for /api/health. Runs a tiny count against
 * the local SQLite DB. SQLite is a local file (synchronous, sub-millisecond), so no
 * timeout race is needed. Never throws.
 */
export async function checkDatabase(): Promise<DbHealth> {
  const startedAt = Date.now()
  try {
    getDb().prepare('SELECT count(*) AS c FROM agents').get()
    return { status: 'up', latency_ms: Date.now() - startedAt }
  } catch {
    return { status: 'down' }
  }
}
