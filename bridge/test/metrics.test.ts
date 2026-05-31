import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import {
  __resetMetrics,
  recordRunCancelled,
  recordRunCompleted,
  recordRunFailed,
  recordRunStarted,
  renderPrometheus,
  snapshotCounters,
} from '../src/lib/metrics.js'

beforeEach(() => __resetMetrics())

test('counters start at zero and increment independently', () => {
  assert.deepEqual(snapshotCounters(), {
    runs_started: 0,
    runs_completed: 0,
    runs_failed: 0,
    runs_cancelled: 0,
    run_latency_ms_sum: 0,
    run_latency_ms_count: 0,
  })

  recordRunStarted()
  recordRunStarted()
  recordRunCompleted(100)
  recordRunFailed()
  recordRunCancelled()

  const snap = snapshotCounters()
  assert.equal(snap.runs_started, 2)
  assert.equal(snap.runs_completed, 1)
  assert.equal(snap.runs_failed, 1)
  assert.equal(snap.runs_cancelled, 1)
})

test('completed-run latency accumulates sum + count; bad values ignored', () => {
  recordRunCompleted(200)
  recordRunCompleted(300)
  recordRunCompleted(-5) // ignored
  recordRunCompleted(Number.NaN) // ignored
  const snap = snapshotCounters()
  assert.equal(snap.runs_completed, 4)
  assert.equal(snap.run_latency_ms_sum, 500)
  assert.equal(snap.run_latency_ms_count, 2)
})

test('snapshot is a copy — callers cannot mutate internal state', () => {
  recordRunStarted()
  const snap = snapshotCounters()
  snap.runs_started = 999
  assert.equal(snapshotCounters().runs_started, 1)
})

test('renderPrometheus emits HELP/TYPE + counter and gauge lines', () => {
  recordRunStarted()
  recordRunCompleted(400)
  const text = renderPrometheus({ runs_active: 2, runs_queued: 5, db_reachable: true })

  assert.match(text, /# TYPE agentroom_bridge_runs_started_total counter/)
  assert.match(text, /^agentroom_bridge_runs_started_total 1$/m)
  assert.match(text, /^agentroom_bridge_runs_completed_total 1$/m)
  assert.match(text, /^agentroom_bridge_run_latency_ms_avg 400$/m)
  assert.match(text, /^agentroom_bridge_runs_active 2$/m)
  assert.match(text, /^agentroom_bridge_runs_queued 5$/m)
  assert.match(text, /^agentroom_bridge_db_reachable 1$/m)
  assert.ok(text.endsWith('\n'))
})

test('renderPrometheus avg latency is 0 when no completed runs measured', () => {
  const text = renderPrometheus({ runs_active: 0, runs_queued: 0, db_reachable: true })
  assert.match(text, /^agentroom_bridge_run_latency_ms_avg 0$/m)
})

test('renderPrometheus reports db_reachable 0 when the DB count was unavailable', () => {
  const text = renderPrometheus({ runs_active: 0, runs_queued: 0, db_reachable: false })
  assert.match(text, /^agentroom_bridge_db_reachable 0$/m)
})
