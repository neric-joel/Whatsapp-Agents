# 0002 — `agent_runs` table is the work queue (no Redis)

- **Status:** Accepted
- **Date:** 2026-05-08

## Context

A user message must fan out to N agents, each producing an independent reply via a
potentially long-running CLI. That needs a queue with claim/heartbeat/retry-ish
semantics. Adding Redis or a broker would add an operational dependency to an
otherwise Supabase-only stack.

## Decision

Use the **`agent_runs` Postgres table as the queue**. A row's `status` column
(`queued → claimed → running → completed | failed | cancelled`) is the state machine.
The bridge polls for `queued` rows and **atomically claims** them with a conditional
update (`update(status='claimed').eq('status','queued')`). Liveness is tracked via
`heartbeat_at`; stale rows are recovered.

## Consequences

- Zero extra infrastructure; the queue is durable, queryable, and visible in the UI
  via Realtime (run cards update live).
- Atomic claim prevents double-processing across workers.
- Polling has latency bounded by `BRIDGE_POLL_INTERVAL_MS` (default 2 s) — acceptable
  for this workload; not a high-throughput broker.
- Recovery and metrics are documented in [OBSERVABILITY.md](../OBSERVABILITY.md).

## Alternatives considered

- Redis / BullMQ / a cloud queue — more capable, but an extra dependency that breaks
  the "Supabase + Docker is all you need" self-hosting story.
- Supabase Realtime/`pg_notify` push instead of polling — considered for a later
  optimization; polling is simpler and robust for the MVP.
