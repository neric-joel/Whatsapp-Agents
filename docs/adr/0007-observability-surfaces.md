# 0007 — Observability: structured logs, health/metrics endpoints, opt-in error tracking

- **Status:** Accepted
- **Date:** 2026-05-31

## Context

When AgentRoom breaks in production you need to see why and it must fail gracefully.
The bridge is a headless daemon with no request surface, so its liveness and metrics
weren't observable; logs were ad-hoc `console.*`; there was no error-tracking hook;
and the web `/api/health` returned a static stub that didn't reflect the database.

## Decision

- **Structured logging:** one shared JSON logger (`packages/shared`) for web + bridge
  (`ts, level, event, …`), level-gated by `LOG_LEVEL`, with **secret/PII redaction**
  applied to every field (`redactDeep`). `console.*` is lint-banned outside a small
  allowlist.
- **Health/readiness:** web `/api/health` does a best-effort DB ping but **always
  returns 200** (readiness in the body) so liveness probes stay green; the bridge runs
  a tiny HTTP server exposing `GET /healthz` (liveness) and `GET /metrics`.
- **Metrics:** in-process counters (runs started/completed/failed/cancelled +
  latency) and active/queued gauges in **Prometheus** exposition, plus a
  `db_reachable` gauge so an empty-queue reading can't be confused with a DB outage.
- **Error tracking:** a shared `createErrorTracker` that is a **no-op without a DSN**,
  adds no dependency, and **redacts before any transport** (default routes through the
  logger). Opt-in via `SENTRY_DSN` / `ERROR_TRACKING_DSN`.

## Consequences

- Liveness, throughput, and failures are observable without coupling to a vendor.
- The health/metrics endpoints are **unauthenticated** → must be bound to
  localhost / an internal network (documented at every layer).
- Counters are process-lifetime (reset on restart); the authoritative history is the
  `agent_runs` table. Full detail in [OBSERVABILITY.md](../OBSERVABILITY.md).

## Alternatives considered

- Bundling the Sentry SDK directly — adds a dependency + weight even when unused;
  rejected in favor of a dependency-free pluggable transport.
- Logging to the DB / a vendor-specific agent — heavier and less portable than
  structured stdout that any drain can collect.
