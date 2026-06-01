import { ok } from '@/lib/api'
import { checkDatabase } from '@/lib/health'

// Run on every request (never prerendered/cached) so the DB ping reflects current
// reality rather than a build-time snapshot.
export const dynamic = 'force-dynamic'

// Liveness + best-effort readiness. ALWAYS returns 200 with the standard
// { ok, data } envelope so container/orchestrator liveness probes (and the CI
// image smoke test) stay green even when the DB is unreachable — the DB status
// is reported in the body (`db: 'up' | 'down' | 'unknown'`), not via the HTTP code.
export async function GET() {
  const db = await checkDatabase()
  return ok({
    service: 'agentroom-web',
    status: 'ok',
    db: db.status,
    ...(db.latency_ms !== undefined ? { db_latency_ms: db.latency_ms } : {}),
    ts: new Date().toISOString(),
  })
}
