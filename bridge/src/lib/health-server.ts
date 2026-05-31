// Minimal HTTP server so the bridge's liveness + runtime metrics are observable
// (the daemon otherwise has no listening socket). Two read-only endpoints:
//   GET /healthz  — liveness JSON: { status, worker_id, uptime_s, active_runs,
//                   last_poll_at }. Always 200 while the event loop is responsive.
//   GET /metrics  — Prometheus text exposition (counters + active/queued gauges).
// Everything else → 404. No auth: bind to localhost / an internal network only
// (see docs/OBSERVABILITY.md). Disabled when BRIDGE_HEALTH_PORT=0.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { type MetricsGauges, renderPrometheus } from './metrics.js'

export interface HealthServerDeps {
  workerId: string
  /** Process start time (ms epoch) for uptime. */
  startedAt: number
  /** Runs currently being processed by this worker. */
  getActiveRuns: () => number
  /** Queued runs (status=queued); best-effort, may be null if the DB is unreachable. */
  getQueuedRuns: () => Promise<number | null>
  /** Last successful poll timestamp (ISO) or null before the first poll. */
  getLastPollAt: () => string | null
  /** Injectable clock for deterministic tests. */
  now?: () => number
}

/**
 * The request handler, exported so tests can drive it without a real socket.
 * Resolves after writing the response. Never throws.
 */
export async function handleHealthRequest(
  req: Pick<IncomingMessage, 'url' | 'method'>,
  res: Pick<ServerResponse, 'writeHead' | 'end'>,
  deps: HealthServerDeps,
): Promise<void> {
  const now = deps.now ?? Date.now
  const method = req.method ?? 'GET'
  const url = (req.url ?? '/').split('?')[0]

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' })
    res.end('Method Not Allowed\n')
    return
  }

  if (url === '/healthz' || url === '/health' || url === '/') {
    const body = JSON.stringify({
      status: 'ok',
      worker_id: deps.workerId,
      uptime_s: Math.floor((now() - deps.startedAt) / 1000),
      active_runs: deps.getActiveRuns(),
      last_poll_at: deps.getLastPollAt(),
    })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(body)
    return
  }

  if (url === '/metrics') {
    let queued = 0
    try {
      queued = (await deps.getQueuedRuns()) ?? 0
    } catch {
      // keep the initial 0 if the queued-count query fails
    }
    const gauges: MetricsGauges = { runs_active: deps.getActiveRuns(), runs_queued: queued }
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
    res.end(renderPrometheus(gauges))
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('Not Found\n')
}

/** Create (but do not start) the HTTP server. Returns null when port <= 0. */
export function createHealthServer(port: number, deps: HealthServerDeps): Server | null {
  if (!Number.isFinite(port) || port <= 0) return null
  const server = createServer((req, res) => {
    void handleHealthRequest(req, res, deps)
  })
  // A health socket must never crash the daemon.
  server.on('error', () => {})
  return server
}
