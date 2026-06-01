# v1.0 Stress, Chaos & Autonomous-Hardening Campaign

**Date:** 2026-05-31 (run timestamps UTC 2026-06-01)
**Branch:** `harden/stress-chaos-v1` (off `main` `db8bb4f`, post-v1.0.0 tag)
**Method:** concurrency saturation (C1–C4) + fault injection (F1–F6) on the warm local
Supabase stack, mock adapter for bulk load + exactly one real `claude-code` run, with
deterministic unit + live-DB regression tests for every fix.

---

## 1. Verdict

**GO** — *v1.0 is robust under concurrency and fault injection.* All concurrency
invariants (cap, terminal-state, no-orphan, exactly-one-message, no double-claim) and
all fault-recovery invariants (orphan reclaim, no completed↔cancel clobber, true
cancellation, no false stale-reclaim, DB-outage survival) hold — after fixing **three
real defects found during the campaign** (one High, two Med/Low), each now covered by a
permanent regression test. No security control was weakened.

## 2. Environment fingerprint

- **Commit:** `harden/stress-chaos-v1` tip (4 commits on `main` `db8bb4f`).
- **Supabase:** local stack (project `Whatsapp-Agents`, db `:54322`), `db:up`; reset to
  the seed + 1 added mock agent (`stress_synth`) so AGENTS_PER_ROOM=4.
- **Worker config:** `BRIDGE_MAX_CONCURRENT_RUNS=3`, poll 1000 ms (campaign),
  heartbeat 5000 ms, stale timeout 60000 ms (C1) / 5000 ms (F1 restart).
- **Adapters:** `mock` for all bulk load; **one** real `claude-code` (`claude` 2.1.159).
- **CONFIG used:** ROOMS=6, AGENTS_PER_ROOM=4, LOAD_WAVES=3, SECOND_WORKER=true,
  REAL_CLI_SMOKE=true (claude-code), ITERATION_BUDGET=12.
- **Baseline gate (green before any change):** typecheck ✓ · lint 0-err ✓ · format ✓ ·
  test **289** ✓ · `pnpm --filter web build` ✓ · `supabase test db` 24 pgTAP ✓ ·
  Playwright e2e **12/12** ✓.

## 3. Scorecard

| ID | Scenario | Load/Fault | Verdict | Evidence |
|----|----------|-----------|---------|----------|
| **C1** | Queue saturation & cap enforcement | 6×4=24 runs/wave ×3, cap 3 | **PASS** | peak in-flight **=3** every wave; 72/72 terminal; **0 orphaned**; global **72 runs == 72 agent messages** (1:1); **0 stale false-positives** after the F4 fix (was 1/72 before) |
| **C2** | Single-room @everyone + /discuss + loop guards | 1 room, fan-out | **PASS** (covered) | C1 per-(room,agent): each active agent replies exactly once, `round_index` bounded by `max_agent_rounds`, **no fan-out explosion** (all runs round 0); loop-guard unit tests green (`handoff.test.ts` cycle A→B→A / hop-cap / round-cap, `discussion-orchestrator.test.ts`, `agent-loop.test.ts`) |
| **C3** | Multi-worker claim contention | 2 workers, 8×4×2 | **PASS** | peak in-flight **=6** (3+3, each enforces its own cap); 64/64 completed; global **64 runs == 64 messages → no double-claim** (atomic claim holds); throughput scaled (32 runs ~5.7 s vs ~8 s single-worker) |
| **C4** | Mixed-adapter realism (1 real CLI) | mock load + 1 `claude-code` | **PASS** | the single real run completed in 4694 ms, reply **"2 + 2 = 4."** (coherent, honored the terse system_prompt), persisted; stopped after one real run |
| **F1** | Bridge hard-kill → restart → stale reclaim | `taskkill /F` + seeded orphans | **PASS** | 3 orphaned `running` runs reclaimed **on startup** (`stale: recovered on startup`, ~74 ms after boot); 15 queued drained to completed; **0 stuck**; 15 completed == 15 messages (**no duplicate** on restart) |
| **F2** | Completed-vs-cancel clobber (R3) | follow-up failure | **PASS** (fixed) | the completed/failed/cancelled writes are status-guarded + follow-ups isolated; unit test: a post-completion follow-up throw leaves the run **completed, not failed**; the same guard family was exercised live in F6 |
| **F3** | Kill-tree / orphaned grandchildren | cancel/timeout | **PASS** (fixed; CI-gated) | POSIX now spawns `detached` + force-kills the **group** (`process.kill(-pid)`); POSIX-gated regression test proves a grandchild is reaped (runs in CI/Linux); Windows path (`taskkill /T`) unchanged |
| **F4** | Stale-detection correctness | NULL/aged/healthy heartbeats | **PASS** (fixed) | deterministic live test: fresh NULL-heartbeat **NOT** recovered, healthy (2 s heartbeat) **NOT** recovered, genuinely-stale (old heartbeat / old NULL) **recovered**; unit tests for the age-guard query shape + status-guard no-op |
| **F5** | Transient DB outage | `docker stop` db ~7 s | **PASS** | bridge process **survived** (health endpoint responded during the outage; uptime grew 242→301 s, no crash/restart); **resumed** after recovery (post-recovery run completed); no state corruption. _Low: poll errors during the outage are not logged (observability gap)._ |
| **F6** | Cancellation under load | cancel 12 of 24 mid-load | **PASS** | 12 cancelled stayed cancelled, **0 flipped to completed** (the R3/F6 guard), 0 stuck non-terminal, freed slots reused (12 completed) |

## 4. Per-scenario detail (key invariants)

- **C1** — Hypothesis: a single worker never exceeds its cap and never loses/duplicates a
  run under a queue ≫ cap. Injection: 24 queued runs/wave (cap 3) ×3 waves via
  `scripts/chaos/concurrency.ts`. Signal: high-frequency sampling of `status IN
  (claimed,running)` (peak=3) + a final DB query (`72 runs == 72 completed == 72 agent
  messages`, 0 orphaned). The first run of C1 **caught a real bug** — 1/72 runs `failed`
  with `stale: recovered by periodic sweep` (the F4 false-positive); after the fix, 0/72.
- **C3** — two bridges (`bridge-sc-1`/`-2`) on one queue; the global 1:1 (64 runs == 64
  messages) proves the atomic claim (`UPDATE … WHERE status='queued' … RETURNING`)
  prevents any run being executed twice.
- **C4** — one real `claude-code` subprocess run end-to-end while mock load was in flight;
  proves the real adapter path (binary resolve → spawn `shell:false` → stdout parse →
  persisted reply) under concurrency.
- **F1** — simulated a crashed worker's leftovers (3 `running` w/ 10-s-old heartbeat) +
  15 queued; a fresh bridge reclaimed the orphans on startup and drained the queue with
  no duplicate messages.
- **F4** — `scripts/chaos/stale-live.ts` invokes the **real** `recoverStaleRuns` against
  controlled rows; proves the age guard (fresh NULL-heartbeat survives) and that
  genuinely-dead runs are still recovered.
- **F5** — `docker stop supabase_db` for ~7 s under idle polling; `/healthz` kept
  responding (process alive), and a run inserted post-recovery completed.
- **F6** — cancelling 12 of 24 in-flight/queued runs; none were clobbered to `completed`
  (the status-guarded completed write), proving cancellation integrity under load.

## 5. Fixes shipped

| Fix | Severity | Commit | Regression test |
|-----|----------|--------|-----------------|
| **R3/F6** — status-guard terminal writes + isolate post-completion follow-ups (no completed→failed / cancel→completed clobber) | **High** (calibrated) | `2cf3209` | `bridge/test/run-worker.test.ts` (follow-up throw → still completed) |
| **F4** — age-guard NULL-heartbeat stale runs + status-guard the recovery write | **High** (live false-positive) | `2664734` | `bridge/test/stale-runs.test.ts` (query shape + no-op) + `scripts/chaos/stale-live.ts` (live semantics) |
| **F3** — POSIX kill-tree: spawn detached + kill the process group | **Low** (POSIX-only orphan) | `95fe02e` | `bridge/test/subprocess-killtree.test.ts` (POSIX-gated, CI/Linux) |
| Chaos harnesses (campaign tooling) | — | `fbd1acd` | self-verifying scripts |

Post-fix gate: typecheck ✓ · lint 0-err ✓ · format ✓ · **test 292** (web 149 + bridge 143;
1 POSIX-skip) ✓. No security control weakened (`shell:false`, static argv, stdin-only
`system_prompt`, RLS write-isolation, tool-approval all untouched).

**Critique gate (security-auditor + code-reviewer, adversarial, refute-by-default):
PASS — 0 Critical/High.** The security reviewer confirmed no control was weakened
(`shell:false`, static argv, stdin-only `system_prompt`, RLS write-isolation, tool-approval,
memory scanning all untouched) and that the negative-pid group-kill correctly targets only
the child's group (the `if (!pid) return` guard prevents signalling the bridge's own group).
The QA reviewer caught one **Medium** that I fixed before shipping: the first R3 regression
test was a **false guard** (with `discussion_mode='independent'` no follow-up actually
queried, so the injected throw never fired — it passed even with the fix reverted). Fixed
by driving the run as `tag_turns` so the mention-followup path issues a post-completion
query; **revert-proven** (the test now FAILS with the fix disabled, PASSES with it).

**PR:** [#40](https://github.com/neric-joel/Whatsapp-Agents/pull/40) → `main`.
**CI: GREEN** — `verify` / `secret-scan` / `codeql` / `CodeQL` / `Playwright` /
`build-images` / `rls` all PASS; only `audit` red (allowed per D3). Two CI self-heals
during ship: (1) `knip` flagged the new `scripts/chaos/*.ts` as unused → broadened the
knip entry glob to `scripts/**/*.ts` (`4e1095c`); (2) the POSIX kill-tree test spawned
its grandchild `detached`, escaping the parent group, so it failed on CI/Linux → made the
grandchild non-detached (inherits the group) + polled waitDead (`85ad279`); verified on
real Linux (`node:22 --init`) that `kill(-pgid)` reaps both.

## 6. Deferred (Medium/Low — tracked, not blocking)

- **R7 (A2A fan-out hardening)** — the mention-followup path still relies on a depth cap
  (no cycle detection / round cap like `handoff.ts`); dedup is read-then-insert (TOCTOU)
  with no unique index on `agent_runs`. All paths still terminate (C1/C2 showed no
  explosion). → fast-follow (this campaign's recommended next goal).
- **F5 observability (Low)** — the bridge poll loop does not log/track errors during a DB
  outage; it survives + resumes but the outage is invisible in logs. → wire into the
  structured logger + error tracker.
- **R3 cancelled-metric (Low)** — when the completed write no-ops because the run was
  cancelled mid-finish, `runs_cancelled` is not incremented (DB status is correct). →
  record on the skip path.
- **Cancelled-run reply micro-race (Low)** — if a cancel lands between the reply insert
  and the completed write, the reply message persists though the run is `cancelled`
  (status integrity holds). → optionally check the abort signal before the message insert.
- **Detached-child orphan on graceful shutdown (Low, security review)** — with
  `detached:true` on POSIX, an in-flight child is its own session leader and won't get the
  controlling-terminal SIGHUP when the bridge exits; `index.ts` `shutdown()` doesn't
  force-kill in-flight children, so a subtree can survive `docker stop`/Ctrl-C as an orphan
  (reparented to init). No privilege gain (same uid + allowlisted secret-stripped env), and
  stale-runs marks the abandoned row failed on next startup. → add a group-SIGTERM→SIGKILL
  sweep of active runs to `shutdown()`.
- **Kill-tree test validates the mechanism, not the adapter wiring (Info)** — the
  POSIX-gated test proves detached-spawn + negative-pid group-kill reaps a grandchild, but
  does not assert the *adapter* spawns with `detached:true`. → a v1.0.1 follow-up could
  exercise the adapter directly so removing `detached` would fail a test.
- **Stale recovery skips a both-NULL row (Info)** — a claimed/running row with BOTH
  `heartbeat_at` and `started_at` NULL is never reclaimed; in practice the claim always sets
  `started_at`, so this is theoretical. → optionally fall back to `created_at` for the age guard.

## 7. Known-gap delta vs ADR-0009

This campaign **closes** the ADR-0009 / sweep-deferred *runtime evidence for the run-state
machine* ("sweep re-run on merged main" for reliability): the completed-vs-cancel clobber
(sweep **R3**, Medium) is **fixed + tested**; the stale-run guards and POSIX kill-tree
(sweep Lows) are **fixed + tested**; concurrency cap / no-double-claim / orphan-reclaim /
DB-outage survival now have **live evidence**. Unaffected ADR-0009 items remain: authed-page
Lighthouse number (axe-covered), responsive screenshots, `next@15` (D3), per-theme authed
axe, README badges-at-tag.

## 8. Next

**Most valuable next `/goal`:** *Harden A2A fan-out (R7)* — add cycle detection + a round
cap to the mention-followup path (mirror `handoff.ts`), stop resetting `deliberation_depth`
on discussion phase-advance, and add a partial unique index on `agent_runs` to make
hand-off/mention dedup atomic (TOCTOU). Couples naturally with wiring the bridge poll-error
into structured logging (F5 Low).
