import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  createHealthServer,
  handleHealthRequest,
  type HealthServerDeps,
} from '../src/lib/health-server.js'
import { __resetMetrics, recordRunStarted } from '../src/lib/metrics.js'

interface FakeRes {
  statusCode?: number
  headers?: Record<string, string>
  body: string
  writeHead(code: number, headers?: Record<string, string>): void
  end(chunk?: string): void
}

function fakeRes(): FakeRes {
  return {
    body: '',
    writeHead(code, headers) {
      this.statusCode = code
      this.headers = headers
    },
    end(chunk) {
      if (chunk) this.body += chunk
    },
  }
}

const baseDeps = (over: Partial<HealthServerDeps> = {}): HealthServerDeps => ({
  workerId: 'bridge-test-1',
  startedAt: 1000,
  getActiveRuns: () => 0,
  getQueuedRuns: async () => 0,
  getLastPollAt: () => null,
  now: () => 6000,
  ...over,
})

beforeEach(() => __resetMetrics())

test('GET /healthz returns 200 liveness JSON with uptime + worker_id', async () => {
  const res = fakeRes()
  await handleHealthRequest(
    { url: '/healthz', method: 'GET' },
    res,
    baseDeps({ getActiveRuns: () => 2, getLastPollAt: () => '2026-05-31T00:00:00.000Z' }),
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers?.['content-type'], 'application/json')
  const json = JSON.parse(res.body)
  assert.equal(json.status, 'ok')
  assert.equal(json.worker_id, 'bridge-test-1')
  assert.equal(json.uptime_s, 5) // (6000 - 1000)/1000
  assert.equal(json.active_runs, 2)
  assert.equal(json.last_poll_at, '2026-05-31T00:00:00.000Z')
})

test('GET / and /health alias to liveness', async () => {
  for (const url of ['/', '/health']) {
    const res = fakeRes()
    await handleHealthRequest({ url, method: 'GET' }, res, baseDeps())
    assert.equal(res.statusCode, 200, url)
    assert.equal(JSON.parse(res.body).status, 'ok', url)
  }
})

test('GET /metrics returns Prometheus text including queued gauge', async () => {
  recordRunStarted()
  const res = fakeRes()
  await handleHealthRequest(
    { url: '/metrics', method: 'GET' },
    res,
    baseDeps({ getActiveRuns: () => 1, getQueuedRuns: async () => 7 }),
  )
  assert.equal(res.statusCode, 200)
  assert.match(res.headers?.['content-type'] ?? '', /text\/plain/)
  assert.match(res.body, /^agentroom_bridge_runs_started_total 1$/m)
  assert.match(res.body, /^agentroom_bridge_runs_active 1$/m)
  assert.match(res.body, /^agentroom_bridge_runs_queued 7$/m)
  assert.match(res.body, /^agentroom_bridge_db_reachable 1$/m)
})

test('GET /metrics tolerates a DB error: queued 0 AND db_reachable 0 (not masked)', async () => {
  const res = fakeRes()
  await handleHealthRequest(
    { url: '/metrics', method: 'GET' },
    res,
    baseDeps({
      getQueuedRuns: async () => {
        throw new Error('db down')
      },
    }),
  )
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /^agentroom_bridge_runs_queued 0$/m)
  assert.match(res.body, /^agentroom_bridge_db_reachable 0$/m)
})

test('GET /metrics reports db_reachable 0 when the queued count is null', async () => {
  const res = fakeRes()
  await handleHealthRequest(
    { url: '/metrics', method: 'GET' },
    res,
    baseDeps({ getQueuedRuns: async () => null }),
  )
  assert.match(res.body, /^agentroom_bridge_db_reachable 0$/m)
})

test('HEAD /healthz returns 200 headers but no body', async () => {
  const res = fakeRes()
  await handleHealthRequest({ url: '/healthz', method: 'HEAD' }, res, baseDeps())
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers?.['content-type'], 'application/json')
  assert.equal(res.body, '')
})

test('unknown path 404s; non-GET 405s', async () => {
  const notFound = fakeRes()
  await handleHealthRequest({ url: '/nope', method: 'GET' }, notFound, baseDeps())
  assert.equal(notFound.statusCode, 404)

  const notAllowed = fakeRes()
  await handleHealthRequest({ url: '/healthz', method: 'POST' }, notAllowed, baseDeps())
  assert.equal(notAllowed.statusCode, 405)
  assert.equal(notAllowed.headers?.allow, 'GET, HEAD')
})

test('createHealthServer returns null when the port is disabled (<= 0)', () => {
  assert.equal(createHealthServer(0, baseDeps()), null)
  assert.equal(createHealthServer(-1, baseDeps()), null)
  const server = createHealthServer(1, baseDeps())
  assert.ok(server) // created but NOT listening
  server?.close()
})
