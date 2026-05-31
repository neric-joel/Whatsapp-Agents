# Phase 6 — Observability & reliability — critique gate

Date: 2026-05-31 · Branch: `harden/p6-observability-reliability` · Diff: `54b105d...HEAD`

Two reviewers ran in parallel on the Phase 6 diff (per `02_SUBAGENTS.md`):

- **Adversarial Chaos Critic** (`general-purpose`, red-team prompt: "what still hangs
  or loses a run?") → initial verdict **FAIL** (1 High, 3 Medium, 4 Low).
- **Code Reviewer** (`code-reviewer` agent) → verdict **PASS** (all Low/Info).

All findings were verified by the lead against the real code before acting.

## Triage

| SEV | Finding | Where | Disposition |
|-----|---------|-------|-------------|
| High | `recordRunStarted()` fired before the `running` transition, so a `cancelled_before_running` early-return (or a claim/running DB throw) left `runs_started` without a matching terminal counter → permanent "phantom stuck run" skew | `run-worker.ts` | **FIXED** — gate all terminal counters on a `started` flag set only after the run truly enters `running`; `recordRunStarted()` moved there. Covers both the cancel-in-gap and the claim-throw (code-reviewer Low) cases. |
| Med | `/metrics` `runs_queued 0` on DB failure is indistinguishable from "queue empty" — masks an outage | `health-server.ts` | **FIXED** — added `agentroom_bridge_db_reachable` gauge (1/0); `runs_queued` documented as meaningful only when reachable=1. |
| Med | HEAD request wrote a JSON body (HTTP non-conformance; tested unit) | `health-server.ts` | **FIXED** — HEAD now sends headers, no body. Test added. |
| Med | Health-server bind failure (EADDRINUSE) swallowed silently → container restart-loop with no diagnostic | `index.ts` | **FIXED** — `healthServer.on('error', …)` logs `health.listen.error`. |
| Med | Redaction was a property of the *default* logger transport, not the tracker — a real injected Sentry/OTLP transport would receive unredacted message/stack/context | `error-tracking.ts` | **FIXED** — `redactDeep` (promoted into `redact.ts`, now shared by the logger too) applied to message/stack/context inside `toEvent`, so every transport gets redacted data. |
| Low | Bridge captured-error lines lost `worker_id` correlation (no logger injected) | `bridge/.../error-tracking.ts` | **FIXED** — export the bridge `logger` and pass it to `createErrorTracker`. |
| Low | Nested non-string secrets in `context` not redacted | shared | **FIXED** — folded into the `redactDeep` fix above. |
| Low | `checkDatabase` timeout branch untested | web | **FIXED** — fake-timers test added (advance 2s → `down`). |
| Low | Cancellation watcher polls every 1s through the approval wait (mild DB-load amplification) | `run-worker.ts` | **Accepted** — correctly cleared in `finally`, no leak; MVP-acceptable. |
| Low | `setTimeout(process.exit,100)` can truncate an in-flight terminal write on shutdown | `index.ts` | **Accepted** — by design + documented; stale-run recovery marks the orphan `failed` next boot. |
| Low | New service client per `/metrics` scrape | `index.ts` | **Accepted** — pre-existing pattern (matches `pollOnce`); no socket leak. |
| Info | `_avg` gauge is lifetime-cumulative (use `rate(sum)/rate(count)` for windows) | `metrics.ts` | **Accepted** — documented in OBSERVABILITY.md; kept for at-a-glance value. |

## Verified clean (both reviewers)

- Web `/api/health` timeout uses a resolve-only sentinel + `finally` clear → no
  unhandled rejection, no hang. (Lead also fixed it being **statically prerendered**:
  added `export const dynamic = 'force-dynamic'` so the DB ping runs per request.)
- Run double-claim still atomic; the DI refactor's only behavioral delta is the
  added metric/capture side-effects — DB-write ordering is byte-identical to base
  (`git show 54b105d:bridge/src/workers/run-worker.ts`).
- Health server cannot crash the daemon (handler never throws; `server.on('error')`).
- `/healthz` + `/metrics` expose no secrets/PII; documented unauthenticated →
  internal network only (Dockerfile/compose/docs repeat the warning).
- Error tracker is a true no-op without a DSN; a throwing transport degrades to
  no-op without breaking the caller.

## Pre-existing, logged (NOT introduced by this diff)

- **Edge-runtime build warning**: `middleware.ts` (Edge) imports `isForbiddenCrossOrigin`
  from `lib/api-security.ts`, which imports the shared `logger` (`process.stdout/err`).
  Verified present at base `54b105d` (api-security imported `logger` since `ae0d7ef`).
  Warning-only; the Edge code path never calls a logging function. Clean fix =
  extract the Edge-safe CSRF helpers into a logger-free module — logged for a small
  follow-up, out of Phase 6 scope.

## Post-fix verification

`pnpm typecheck` ✓ · `lint` 0 errors/7 known warns ✓ · `format:check` ✓ · `knip` 0 ✓ ·
tests **web 113 + bridge 84 = 197** ✓ · `pnpm --filter web build` ✓ (`/api/health` = ƒ dynamic).

**Final verdict: PASS** — 0 open Critical/High; all Critical/High/Medium fixed,
Lows accepted with rationale or fixed.
