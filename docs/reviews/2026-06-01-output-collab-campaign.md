# Output Stress-Test · Architecture Reconciliation · Real Team Collaboration

**Date:** 2026-06-01 · **Branch:** `feat/collab-and-output-hardening` (off `feat/product-validation-v1`)
**Mode:** autonomous (brainstorm → judge-panel → ADR → implement → verify). `main` + `v1.0.0` untouched; nothing pushed.

## 1. Verdict — **GO**

- **Outputs are correct** where it counts: command routing, message integrity, mentions, and the
  hallucination flag were stress-driven; the one real output defect found (hallucination
  confidence inflation + a React dup-key) is **fixed with a regression test**.
- **`/discuss` is now genuine teamwork.** Proven live with **real** agents (codex coordinator +
  claude): a problem is **decomposed and assigned by capability**, each agent **executes its part
  while building on peers' specific contributions**, they **cross-review and challenge** each
  other, and a **single attributed answer** converges — bounded, no runaway, no rubber-stamp.
  `/debate` is now a genuinely distinct adversarial machine.

Gate: typecheck 0 · bridge 161/161 · shared 10/10 · web 154/154 · `next build` ✓ · migration applied.

## 2. As-built architecture map (Part A — observed, then reconciled)

Built from an 8-agent parallel read of the binding subsystems + live driving of the running
system (mock room for structure/cost, real agents for the transcript), capturing **output + rows
+ logs** per flow.

**`/discuss` data flow (as-built, before this campaign):**
```
"/discuss X" (or "/debate X", or "@everyone X?")  ─ web messages route
  └─ parseDiscussionRequest → rewrite content to phase-1 prompt; metadata.discussion={phase:'individual'}
  └─ selectTargetAgents short-circuits → ALL active agents, ONE run each @ round_index=0  (parallel)
        └─ bridge run-worker → buildContextPacket (window = created_at <= trigger)  ← peers invisible
        └─ on all-terminal → maybeScheduleDiscussionContinuation
              individual(all) → critique(all) → consensus(ONE agent = selectConsensusAgent)
```

**Intended-vs-observed divergences (every one verified live with 3-layer evidence):**

| # | Divergence (intended → observed) | Sev | Evidence | Resolution |
|---|---|---|---|---|
| D1 | "agents build on each other" → **phase-N agents are blind to peers** | High | `build-context-packet.ts:88 .lte('created_at', triggerMsg.created_at)`; all same-phase runs share one trigger ts | **Fixed** (discussion-scoped query, ADR-0011) |
| D2 | "team consensus" → **one hard-picked agent writes it** | High | live: round-2 consensus = exactly 1 agent (`selectConsensusAgent` codex-or-first) | **Fixed** (coordinator composes *from* the blackboard with attribution; team executes+reviews) |
| D3 | "@mention one other agent" (phase-1 prompt) → **inert** (all already running) | High | `shared index.ts:87` prompt vs parallel fan-out | **Fixed** (removed; phase machine drives turns) |
| D4 | `/debate` adversarial → **cosmetic alias of /discuss** | Med | live: identical 3-phase rows; orchestrator never reads `command` | **Fixed** (assign→argue→rebut→adjudicate, distinct prompts) |
| D5 | no decomposition / capability-assignment anywhere | Med | `capabilities` rendered only into an agent's own prompt; read by no coordinator | **Fixed** (coordinator plan + `parseTaskList` assignments) |
| D6 | `@everyone X?` silently becomes a full 3-phase deliberation | Med | live: `@everyone …?` → command=discuss, 3 phases | Documented (intentional shortcut; behavior preserved, now flows through the new machine) |
| D7 | continuation resets `deliberation_depth:0, root_id:null` each phase | Med | `discussion-orchestrator.ts:214` | **Fixed** (depth carried as phase number; root null is FK-correct) |
| D8 | `conclusionDetected` never stops chaining (dead code) | Med | only referenced by its own test | Superseded by `detectChallenge` (live gate) |
| D9 | phase advances even if every run FAILED | Med | `TERMINAL_STATUSES` includes failed/cancelled | **Fixed** (require ≥1 completed run) |
| D10 | mention-follow-up has no cycle detection; fires in discussion | Med→High | `agent-follow-up.ts`; **live: discussion @slug prompts spawned stray runs** | **Fixed** (follow-ups suppressed for discussion runs) |
| D11 | hallucination confidence inflated by duplicate reasons | Med | `hallucination.ts:29-41` nested loop pushes same reason N× | **Fixed** (dedupe + regression test) |
| D12 | command parity (registry⇄parser⇄dispatch) | — | re-verified all 10 commands; live `/debate`, `@everyone`, `@slug` | **PASS** |

## 3. Output-bug scorecard (Part B)

| input | expected | observed | sev | root cause | fix |
|---|---|---|---|---|---|
| reply with 2 self-contradictions | 1 reason, confidence reflects 1 category | reason duplicated → confidence 'medium'/'high'; React "two children with same key" in HallucinationBanner | **Med** | `detectHallucination` nested loop pushes same reason per outer line; banner keyed by reason text | dedupe reasons via Set before flag/confidence; key `<li>` by index; **regression test** (commit c9f0131) |
| `/discuss` (phase-N agent) | sees peers' drafts | saw none (parallel-blindness) | **High** | timestamp-bounded context window | scoped query (ADR-0011, cb4c404) |
| `/discuss` final | team consensus, attributed | one agent invents it | **High** | single `selectConsensusAgent` | coordinator composes from blackboard (cb4c404) |
| `/discuss` with @slug in prompts | phase machine drives turns | stray mention-follow-up runs | **High** | tag_turns follow-up fired on phase prompts | suppress follow-ups for discussion runs (5566c68) |
| `/debate X` | adversarial (distinct positions) | identical to /discuss | **Med** | `command` never branched on | distinct debate machine (98553c3) |
| command registry⇄dispatch (×10) | parity | parity (incl `/debate`) | — | — | verified, no change needed |
| plain `@everyone` / `@slug` routing | fan-out / single | correct | — | — | verified |

Agent-CLI preamble noise ("I'll load the required Superpowers guidance…") appears in real replies
— it originates in the host CLI's own skill environment, not AgentRoom code; **Low**, deferred.

## 4. Collaboration redesign (Part C — the main prize)

**Before:** all agents draft in parallel (blind) → all critique (blind) → **one agent** writes the
"consensus". No decomposition, no peer-building, no attribution, no challenge. `/debate` == `/discuss`.

**After (ADR-0011 — [docs/adr/0011-team-collaboration-discuss.md](../adr/0011-team-collaboration-discuss.md)):**
a supervisor/orchestrator-worker + role-based team over a shared blackboard:

```
/discuss:  plan(coordinator: decompose+assign by capability)
        →  execute(all: each does its part, SEES + builds on peers)
        →  integrate(all: cross-review pairs; must challenge)
        →  dissent(all — ONLY if no challenge yet; anti-sycophancy)
        →  converge(coordinator: attributed synthesis, no new substance)
/debate:   assign → argue → rebut → adjudicate (distinct positions; winner, not merge)
```
Peer visibility fixed by a **discussion-scoped context query** (whole thread by
`original_message_id`, minus a self-echo filter). Bounded by a DAG + two ceilings
(`DISCUSSION_MAX_PHASES=5`, `ABS_MAX_DISCUSSION_ROUNDS=6`) + the reused unique-index idempotency.
≤ `COLLAB_MAX_AGENTS=3` in the tight loop.

### Annotated **real** `/discuss` transcript (codex coordinator + claude; isolated room)

Problem: *"Design a small LRU cache: data structures, get/put, eviction edge cases."*

```
round 0  plan       @cqa_planner (coordinator)  →  decomposes + assigns @cqa_planner / @cqa_coder
round 1  execute    @cqa_planner                →  owns the behavioral contract + edge cases
         execute    @cqa_coder      [challenge] →  "Owning my blackboard line. I'll BUILD ON the
                                                    contract @cqa_planner is defining (capacity 0/1,
                                                    overwrite, get-miss, eviction order, recency)…"
round 2  integrate  @cqa_planner    [challenge] →  cross-reviews @cqa_coder's impl, flags gaps
         integrate  @cqa_coder                  →  cross-reviews @cqa_planner's contract
round 3  converge   @cqa_planner    →  "Contributions:
                                        - @cqa_planner owned the behavioral contract and edge-case
                                          checklist: capacity 0/1, overwrite, miss, eviction, recency.
                                        - @cqa_coder owned the implementation design: hash map +
                                          doubly linked list, get/put, move-to-front, tail eviction,
                                          O(1).
                                        Unified team answer: …"
```
- **Distinct sub-tasks owned by different agents** ✓ — planner=contract, coder=implementation.
- **Agents extend each other's *specific* contributions** ✓ — coder builds on the planner's named contract.
- **Integrated answer with attribution** ✓ — the explicit "Contributions:" block.
- **≥1 substantive challenge; no rubber-stamp** ✓ — `challenge=true` stamped in execute + integrate, so
  the anti-sycophancy gate **correctly skipped the forced dissent** and converged.
- **Bounded, terminates** ✓ — 4 phases, no further runs scheduled.

(A mock-agent run additionally exercises the **dissent** stage: mock replies never challenge, so the
gate inserts plan→execute→integrate→**dissent**→converge.)

## 5. Decisions log (autonomous)

- **ADR-0011** — team-collaboration `/discuss`. Design chosen by a 3-proposal judge-panel; winner
  D3 (safety-first) grafted with D1's zero-new-column budget + D2's per-agent assignment.
- **Parallel-blindness fix** = discussion-scoped query (option b), not serialize/stagger (rejected:
  slower, fights atomic-claim, still loses late peers).
- **`deliberation_root_id` stays null** for discussion runs: its FK references `agent_runs(id)`, so
  the ADR's "root = original_message_id" was infeasible; intent (bounded handoffs) preserved via
  carried-forward `deliberation_depth`. (Discovered live via an FK violation.)
- **Unique index scoped to trigger messages** (`sender_type in (system,user)`) so agent replies can
  carry `phase` for the scoped query without colliding with the phase trigger. (Discovered live.)
- **Mention/hand-off follow-ups suppressed in discussion** — the phase machine is the sole driver.
- **No `supabase db reset`** — would wipe the runtime-created `pv` user + leave the app unusable;
  the index-only migration was applied directly (idempotent) and is verified to apply cleanly.

## 6. Fixes shipped / deferred

**Shipped** (`feat/collab-and-output-hardening`): c9f0131 (hallucination dedupe + test),
98553c3 (phase machine + plan kickoff + 10 unit tests), cb4c404 (orchestrator + scoped peer query
+ run-worker stamp + migration + 9 orchestrator tests), 5566c68 (suppress follow-ups in discussion),
**7ef7e9e** (post-critique: HIGH security fix + COLLAB_MAX_AGENTS cap + anti_sycophancy audit flag).

**`/critique qa` + `security`** (reports: [collab-security](2026-06-01-collab-security.md),
[collab-qa](2026-06-01-collab-qa.md)) — the panel found **1 HIGH** (a client could self-stamp
`metadata.discussion` on a normal message → the scoped query leaks another in-room discussion's
transcript) + 2 Med guardrail gaps (COLLAB_MAX_AGENTS unenforced; anti_sycophancy flag never
written). **All fixed before ship** (7ef7e9e), each with a regression test. Room isolation,
challenge-spoofing, the migration re-scope, and all untouched invariants **SURVIVED**.

**Deferred (tracked):** 1-agent-room `/discuss` coherence + a partial-phase-failure intent test +
coordinator-leaves-mid-discussion test (QA Med/Low — out of the ≤3-agent tight-loop scope);
non-atomic orphaned-phase-message recovery (Low); `fakeCite` whitespace-URL false-positive
(pre-existing, Low); agent-CLI preamble noise (host-CLI behavior, Low); CI Tier-2 to gate the
live discussion integration test (needs Supabase-in-CI, stubbed in `e2e.yml`); a real `/debate`
adjudication transcript (machine verified structurally; not captured to conserve the ~14/25
real-call budget); `@everyone X?` auto-escalation could become explicit opt-in (D6).

## 7. Next `/goal`

Capture a real `/debate` adjudication transcript and wire the Tier-2 CI job so the live
discussion integration test (≥2 agents contribute distinct referenced parts; chain terminates)
gates CI; then consider a 4th+ agent scaling test against `COLLAB_MAX_AGENTS`.
