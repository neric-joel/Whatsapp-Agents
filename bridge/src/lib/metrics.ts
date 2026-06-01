// In-process runtime metrics for the Bridge Daemon. Counters are monotonic
// (process-lifetime); gauges (active/queued runs) are supplied at render time by
// the caller, which owns that state. Exposed by the health server's /metrics
// endpoint in Prometheus text exposition format, and as JSON for /healthz.
//
// No external dependency: a single in-memory object, reset()-able for tests. A
// restart resets counters — that is expected for a process-lifetime metric; the
// authoritative run history lives in the agent_runs table.

interface MetricsCounters {
  runs_started: number
  runs_completed: number
  runs_failed: number
  runs_cancelled: number
  /** Sum of completed-run durations (ms) — with _count gives an average latency. */
  run_latency_ms_sum: number
  run_latency_ms_count: number
}

/** Gauges the caller measures at scrape time (not tracked in this module). */
export interface MetricsGauges {
  runs_active: number
  runs_queued: number
  /** 1 if the queued-count query succeeded, 0 if the DB was unreachable. */
  db_reachable: boolean
}

const counters: MetricsCounters = {
  runs_started: 0,
  runs_completed: 0,
  runs_failed: 0,
  runs_cancelled: 0,
  run_latency_ms_sum: 0,
  run_latency_ms_count: 0,
}

export function recordRunStarted(): void {
  counters.runs_started += 1
}

export function recordRunCompleted(latencyMs: number): void {
  counters.runs_completed += 1
  if (Number.isFinite(latencyMs) && latencyMs >= 0) {
    counters.run_latency_ms_sum += latencyMs
    counters.run_latency_ms_count += 1
  }
}

export function recordRunFailed(): void {
  counters.runs_failed += 1
}

export function recordRunCancelled(): void {
  counters.runs_cancelled += 1
}

/** Snapshot the current counters (copy — callers cannot mutate internal state). */
export function snapshotCounters(): MetricsCounters {
  return { ...counters }
}

/** Test-only: zero every counter. */
export function __resetMetrics(): void {
  counters.runs_started = 0
  counters.runs_completed = 0
  counters.runs_failed = 0
  counters.runs_cancelled = 0
  counters.run_latency_ms_sum = 0
  counters.run_latency_ms_count = 0
}

/** Render counters + caller-supplied gauges as Prometheus text exposition format. */
export function renderPrometheus(gauges: MetricsGauges): string {
  const c = counters
  const avgLatency = c.run_latency_ms_count > 0 ? c.run_latency_ms_sum / c.run_latency_ms_count : 0
  const lines = [
    '# HELP agentroom_bridge_runs_started_total Agent runs claimed and started.',
    '# TYPE agentroom_bridge_runs_started_total counter',
    `agentroom_bridge_runs_started_total ${c.runs_started}`,
    '# HELP agentroom_bridge_runs_completed_total Agent runs that completed successfully.',
    '# TYPE agentroom_bridge_runs_completed_total counter',
    `agentroom_bridge_runs_completed_total ${c.runs_completed}`,
    '# HELP agentroom_bridge_runs_failed_total Agent runs that ended in a failed state.',
    '# TYPE agentroom_bridge_runs_failed_total counter',
    `agentroom_bridge_runs_failed_total ${c.runs_failed}`,
    '# HELP agentroom_bridge_runs_cancelled_total Agent runs cancelled by a user.',
    '# TYPE agentroom_bridge_runs_cancelled_total counter',
    `agentroom_bridge_runs_cancelled_total ${c.runs_cancelled}`,
    '# HELP agentroom_bridge_run_latency_ms_sum Total completed-run latency (ms).',
    '# TYPE agentroom_bridge_run_latency_ms_sum counter',
    `agentroom_bridge_run_latency_ms_sum ${c.run_latency_ms_sum}`,
    '# HELP agentroom_bridge_run_latency_ms_count Completed runs with a measured latency.',
    '# TYPE agentroom_bridge_run_latency_ms_count counter',
    `agentroom_bridge_run_latency_ms_count ${c.run_latency_ms_count}`,
    '# HELP agentroom_bridge_run_latency_ms_avg Average completed-run latency (ms).',
    '# TYPE agentroom_bridge_run_latency_ms_avg gauge',
    `agentroom_bridge_run_latency_ms_avg ${avgLatency}`,
    '# HELP agentroom_bridge_runs_active Runs currently being processed by this worker.',
    '# TYPE agentroom_bridge_runs_active gauge',
    `agentroom_bridge_runs_active ${gauges.runs_active}`,
    '# HELP agentroom_bridge_runs_queued Runs waiting in the queue (status=queued). Only meaningful when db_reachable=1.',
    '# TYPE agentroom_bridge_runs_queued gauge',
    `agentroom_bridge_runs_queued ${gauges.runs_queued}`,
    '# HELP agentroom_bridge_db_reachable 1 if the queued-count DB query succeeded at scrape time, else 0.',
    '# TYPE agentroom_bridge_db_reachable gauge',
    `agentroom_bridge_db_reachable ${gauges.db_reachable ? 1 : 0}`,
  ]
  return lines.join('\n') + '\n'
}
