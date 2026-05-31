# Phase 10 — First-class agent-to-agent interaction — critique review

**Date:** 2026-05-31
**Branch:** `harden/p10-agent-to-agent` (PR → `main`)
**Reviewers (parallel):** `security-auditor` (MANDATORY for Phase 10, adversarial) + `code-reviewer`
**Scope:** roster in the context packet, the `handoff_requested` event + `agents/handoff.ts` (loop guards + cycle detection), run-worker wiring, `/handoff` + `/agents` web surface, ARCHITECTURE docs.

## Verdicts

| Reviewer | Initial | After fixes | Critical | High | Medium | Low |
|---|---|---|---|---|---|---|
| security-auditor | **PASS** | PASS | 0 | 0 | 1 | 1 |
| code-reviewer | **FAIL** | **PASS** (re-verified) | 0 | 2 (fixed) | 2 (fixed) | 2 |

**Gate result: PASS — 0 open Critical/High** after the self-heal below.

## The hard gate — agent hand-off chains provably terminate (security-auditor: PASS)
The auditor traced the math: every hop sets `round_index+1` and `deliberation_depth+1` on the peer run; both strictly increase down a chain; `round_index` is **never reset** on any agent-reachable path (the discussion-continuation reset is round-capped and only the user `/discuss` route can trigger it); the round cap (`< max_agent_rounds`) is a hard ceiling reached before the hop cap. Cycle detection (`collectChainAgents` over the shared `deliberation_root_id`, plus the source agent) correctly rejects `A→B→C→A`; self-handoff is rejected. **No infinite/unbounded-exponential explosion is possible.** RLS still blocks all browser writes and cross-room reads; `capabilities` is operator/seed-set only (not attacker-controlled); slug resolution is parameterized (no SQL injection).

## High findings (code-reviewer) — FIXED
1. **The bridge hand-off engine was runtime-unreachable** — no adapter *emitted* `handoff_requested` (same latent gap as Phase 9's `memory_op`). **Fixed:** `SubprocessAdapter.parseStdoutLine` now recognizes agent-emitted control envelopes (`{type:'handoff_requested',…}` and `{type:'memory_op',…}`) from CLI stdout and emits the events; the codex adapter defers unrecognized JSON to the base parser. New `adapter-control-events.test.ts` proves emission; new `run-worker.test.ts` integration test proves a `handoff_requested` event creates a targeted peer run end-to-end (and that a blocked hand-off doesn't break the run).
2. **Docs claimed user `/handoff` used the cycle-detection engine** — it actually rewrites to a targeted `@mention` message (mention path, no cycle detection). **Fixed:** `ARCHITECTURE.md` now distinguishes the **agent-emitted** hand-off (handoff.ts, full guards + cycle detection) from the **user `/handoff`** convenience (a mention shortcut, round/hop-bounded but not cycle-detected — a human turn isn't a loop risk).

## Medium findings — FIXED / accepted
- **Roster advertised non-addressable peers** (`reply_enabled` divergence): roster query now filters `reply_enabled=true`, matching the resolver + mention path. (fixed, code-reviewer)
- **No integration test for the run-worker hand-off wiring**: added (see High #1). (fixed)
- **Cycle-detection race → bounded duplicate runs** (security, Medium): a blanket unique index on `(deliberation_root_id, agent_id)` would *regress* the existing `tag_turns` follow-up (which legitimately re-runs an agent in a chain), so instead added a **per-run hand-off cap** (`MAX_HANDOFFS_PER_RUN=4`, logged drop) to bound fan-out width; the round cap already bounds total runs. Residual race is bounded amplification (not non-termination) — accepted + documented.

## Low findings — addressed / accepted
- Unbounded per-run hand-off list → per-run cap (above). (fixed)
- Hand-off dedup now scopes by `room_id` for consistency. (fixed)
- Hop-cap operator (`>` vs the web guard's `>=`) — different counters; documented in ARCHITECTURE; left as-is. (accepted)
- Roster `capabilities` length/newline clamp — pre-emptive hardening for if a user-facing capabilities editor lands later. (deferred note)

## Post-fix verification
- typecheck ✓ · lint 0-err/10-warn (established `set-state-in-effect` pattern) ✓ · format ✓ · knip 0 ✓
- bridge tests **130** (handoff guards/cycle/caps + roster + adapter envelopes + run-worker integration) · web **133** ✓
- `next build` compiled, 0 Edge-runtime warnings ✓
- DB migration (`agents.capabilities`) applies in CI; no RLS change (hand-offs reuse `agent_runs`).
