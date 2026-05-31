# Observability & reliability

How AgentRoom logs, exposes health/metrics, tracks errors, and keeps the agent-run
state machine from getting stuck. Covers both processes: the **web** app (Next.js
route handlers) and the **bridge** daemon (the queue worker that runs agent CLIs).

---

## 1. Structured logging

Both processes emit **one JSON line per event** through a shared logger
(`packages/shared/src/logger.ts`), so logs are greppable and drain-friendly:

```json
{"ts":"2026-05-31T09:49:31.772Z","level":"info","event":"run.start","worker_id":"bridge-local-1","run_id":"…","agent_id":"…","room_id":"…"}
```

- **Fields:** `ts` (ISO), `level`, `event` (dotted name), plus base fields
  (`service:"agentroom-web"` in web; `worker_id` in the bridge) and per-event fields.
- **Correlation:** bridge run events carry `run_id`; `logger.child({ run_id })` binds
  it to every line for a run.
- **Levels:** `debug | info | warn | error`, gated by `LOG_LEVEL` (default `info`).
  `error` → stderr, everything else → stdout.
- **Redaction:** every field value is run through the shared `redact()` before
  serialization, so tokens/keys/JWTs/emails cannot leak via logs — including values
  forwarded to error tracking. Stray `console.*` is disallowed by lint
  (`no-console`), with a small allowlist for client error boundaries / scripts / tests.

---

## 2. Health & readiness

### Web — `GET /api/health`

Always returns **HTTP 200** with the standard envelope (so container/orchestrator
liveness probes and the CI image smoke test stay green even when the DB is down).
Readiness is reported in the body, not the status code:

```json
{ "ok": true, "data": {
  "service": "agentroom-web", "status": "ok",
  "db": "up", "db_latency_ms": 12, "ts": "2026-05-31T09:50:00.000Z"
}}
```

`db` is a best-effort, **2 s-timeout** count against `agents` (`lib/health.ts`):
`up` (reachable), `down` (error/timeout/unreachable). The check never throws and
never blocks the response.

### Bridge — `GET /healthz`

The daemon has no request surface of its own, so it runs a tiny HTTP server
(`bridge/src/lib/health-server.ts`) on `BRIDGE_HEALTH_PORT` (default `9090`;
set `0` to disable). `/healthz` (aliases: `/`, `/health`) returns liveness:

```json
{ "status": "ok", "worker_id": "bridge-local-1", "uptime_s": 137,
  "active_runs": 2, "last_poll_at": "2026-05-31T09:50:00.000Z" }
```

`last_poll_at` advances every `BRIDGE_POLL_INTERVAL_MS`; a stale value means the
poll loop has stalled. **These endpoints are unauthenticated — bind them to
localhost or an internal network only** (don't expose `9090` publicly).

---

## 3. Metrics

`GET /metrics` on the bridge health server returns Prometheus text exposition:

| Metric | Type | Meaning |
|---|---|---|
| `agentroom_bridge_runs_started_total` | counter | runs claimed and started |
| `agentroom_bridge_runs_completed_total` | counter | runs completed successfully |
| `agentroom_bridge_runs_failed_total` | counter | runs ended in a failed state |
| `agentroom_bridge_runs_cancelled_total` | counter | runs cancelled by a user |
| `agentroom_bridge_run_latency_ms_sum` / `_count` | counter | completed-run latency (sum/count → average) |
| `agentroom_bridge_run_latency_ms_avg` | gauge | average completed-run latency (ms) |
| `agentroom_bridge_runs_active` | gauge | runs in flight on this worker |
| `agentroom_bridge_runs_queued` | gauge | runs waiting (`status='queued'`) |

Counters are process-lifetime and reset on restart (the authoritative run history
lives in the `agent_runs` table). The queued gauge is a live, best-effort DB count
(0 if the DB is briefly unreachable).

---

## 4. Error tracking (opt-in)

Disabled by default — **no DSN, no dependency, no network egress.** Set `SENTRY_DSN`
or `ERROR_TRACKING_DSN` (web or bridge) to forward server-side errors. With no DSN,
`capture()` is a guaranteed no-op (unit-tested). The default transport routes the
captured error through the structured (redacted) logger as `event:"error.captured"`;
inject a real Sentry/OTLP transport via `createErrorTracker({ transport })` without
touching call sites. Capture points: bridge `run.failed` and web `internalError()`.

---

## 5. Reliability — the run state machine

States: `queued → claimed → running → (completed | failed | cancelled)`. Guarantees:

- **Atomic claim.** A run moves `queued→claimed` via a conditional update
  (`.eq('status','queued')`); only one worker wins, so no double-processing.
- **Every path terminates.** Any error in `processRun` writes `status='failed'`
  with a redacted `error_message`; a user cancel writes `status='cancelled'`. There
  is no code path that leaves a run stuck in `claimed`/`running` on this worker.
- **Subprocess safety** (`subprocess-adapter.ts`): per-run timeout (default 120 s),
  combined stdout+stderr **output cap** (10 MB → kill), and `SIGTERM → 2 s →
  force-kill the process tree` so a CLI that ignores termination can't wedge a run.
- **Cancellation truly kills work.** A 1 s watcher polls the run's status; on
  `cancelled` it aborts the `AbortController`, which kills the child and ends the run.
- **Bad agent output** (no `final_response`, invalid JSON) → the run fails cleanly
  with an actionable message rather than hanging.
- **DB / Supabase errors** during the run (e.g. reply insert fails) → caught →
  `failed`, never a half-written success.

### Stale-run recovery

If a worker crashes mid-run, its run is left `claimed`/`running` with a stale
`heartbeat_at`. Recovery (`bridge/src/lib/stale-runs.ts`) runs **on startup** and on
a **periodic sweep**, marking any run whose `heartbeat_at` is null or older than
`BRIDGE_STALE_RUN_TIMEOUT_MS` (default 60 s) as `failed`
(`error_message: 'stale: recovered …'`). Heartbeats are written every
`BRIDGE_HEARTBEAT_INTERVAL_MS` (default 5 s) for active runs.

**Recovered runs are NOT auto-retried** — the user re-sends. This is deliberate:
auto-retrying a run whose side effects (tool calls, partial replies) already
happened could duplicate work. Graceful shutdown (`SIGTERM`/`SIGINT`) stops the
loops so no new run is claimed; an in-flight run is recovered as above on next boot.

---

## 6. Tests (evidence)

- `bridge/test/metrics.test.ts` — counter/latency math + Prometheus rendering.
- `bridge/test/health-server.test.ts` — `/healthz`, `/metrics`, 404/405, DB-error
  tolerance, disabled-port.
- `bridge/test/run-worker.test.ts` — induced child-crash, bad-output, DB-error →
  clean `failed` (exactly one terminal write, "no lost run"); cancellation → clean
  `cancelled`.
- `bridge/test/stale-runs.test.ts` — stale recovery marks claimed/running failed.
- `apps/web/lib/__tests__/health.test.ts` — DB ping up/down/never-throws.
- `apps/web/lib/__tests__/error-tracking.test.ts` — no-op without DSN; forwards with.
- `apps/web/lib/__tests__/logger.test.ts` — JSON shape, redaction, level threshold.
