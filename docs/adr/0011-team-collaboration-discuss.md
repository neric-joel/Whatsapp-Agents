# ADR-0011: Redesign `/discuss` into a real human-style team (plan → execute → integrate → converge), `/debate` as the adversarial sibling

Status: Accepted (autonomous campaign — decide/ADR, no human gate)
Date: 2026-06-01
Supersedes: the 3-phase `individual → critique → consensus` discussion flow (ADR-supersede of the
behavior, not a prior ADR file)
Chosen by: design judge-panel (3 independent senior designs scored + synthesized). Winner **D3**
(correctness/guardrails-first) grafted with **D1**'s zero-new-column budget and **D2**'s per-agent
assignment.

## Context — `/discuss` is a fake team (verified live + in code)

- **Parallel blindness** (`bridge/src/context/build-context-packet.ts:88`): the context window is
  `.lte('created_at', triggerMsg.created_at)`. Every same-phase run shares one trigger timestamp,
  so a phase-1 agent provably never sees a peer's phase-1 draft (written later). The phase-1
  prompt's "@mention one other agent" line (`packages/shared/src/index.ts:87`) is inert.
- **No decompose/assign**: kickoff fans one run per active agent (`agent-targeting.ts:18`
  short-circuits to `allActive`); `agents.capabilities` is rendered only into an agent's *own*
  prompt and read by no coordinator; the roster in every packet *excludes self*
  (`build-context-packet.ts:136`), so no packet has the full team.
- **One agent invents the "consensus"** — phase 3 = `selectConsensusAgent` = slug-includes-codex
  or `members[0]` (`discussion-orchestrator.ts:94`). LIVE-CONFIRMED: round-2 consensus = exactly 1
  agent.
- **`/debate` is cosmetic** — `command` captured at kickoff (`route.ts:99`) but never branched on;
  LIVE-CONFIRMED byte-identical to `/discuss`.
- **Latent bugs**: continuation runs reset `deliberation_depth:0, deliberation_root_id:null`
  (`discussion-orchestrator.ts:214-215`); `conclusionDetected` is dead code; `@everyone …?`
  silently auto-escalates to a 3-phase discussion.

## Decision — final design

### 1. Phase / state machine (`metadata.discussion.phase` is the sole driver; `round_index` is the odometer)

```
discuss:  plan → execute → integrate → (dissent?) → converge
debate:   assign → argue → rebut → adjudicate
```

| Phase | round_index | Who runs | Fan-out | Peers visible |
|---|---|---|---|---|
| `plan`/`assign` | 0 (kickoff) | coordinator only | 1 | sees full roster+capabilities |
| `execute`/`argue` | 1 | all active (≤3) | N | yes |
| `integrate`/`rebut` | 2 | all active | N | yes |
| `dissent` (discuss only, conditional) | 3 | all active | N | yes |
| `converge`/`adjudicate` | 3 or 4 | coordinator only | 1 | yes |

`nextDiscussionStage(command, phase, threadHasChallenge)` is a **DAG** (monotonic, no back-edges) →
returns `null` after converge/adjudicate (self-terminates). `dissent` is emitted **only when**
`command==='discuss' && phase==='integrate' && !threadHasChallenge`. `/debate` skips dissent
(adversarial positions guarantee challenge).

#### Three independent termination backstops
1. **Phase budget** — `DISCUSSION_MAX_PHASES = 5` compile-time constant; orchestrator stops past it.
2. **Absolute round ceiling** — `ABS_MAX_DISCUSSION_ROUNDS = 6` (≤ `max_agent_hops`); orchestrator
   returns when `currentRoundIndex >= ceiling`. The route guard (`route.ts:170`) only fires at
   kickoff (round 0) for non-discussion paths and is untouched; continuation phases are scheduled
   by the bridge orchestrator, which enforces the two ceilings above.
3. **Idempotency** — the existing partial unique index
   `messages_discussion_phase_unique(room_id, original_message_id, phase)` makes each phase
   insertable exactly once (`23505` → no-op). New phase strings are distinct → generalizes with no
   schema change.

### 2. Parallel-blindness fix — discussion-scoped peer query (option b)

Rejected serialize/stagger (slows linearly, fights atomic-claim, still loses late peers). In
`build-context-packet.ts`, when the trigger message carries discussion metadata, load the WHOLE
thread by `original_message_id` ignoring the trigger timestamp, with a **self-echo filter** (drop
the acting agent's own message *from the current phase*), capped by a discussion context limit
(default 24). Non-discussion path unchanged.

**Prerequisite stamp:** `run-worker.ts` must copy `metadata.discussion` (with
`challenge: detectChallenge(reply)`) onto each agent reply when the trigger is a discussion message
— today replies carry no discussion metadata, so the scoped query couldn't see peers.

### 3. Decompose / assign — coordinator

- **Identity:** deterministic `selectCoordinatorAgent(members)` (rename/generalize of
  `selectConsensusAgent`): slug-includes-codex/provider codex_cli → longest `capabilities` blurb →
  `members[0]`. Idempotent on retry.
- **Full roster reaches the coordinator:** add `coordinator_roster?: RosterAgent[]` (full team
  *including self*) to `ContextPacketV1`, populated only when the acting agent is the coordinator
  and phase ∈ {plan, assign, integrate}. Rendered into the plan prompt as **DATA, not instructions**.
- **Blackboard** in `metadata.discussion`: `assignments[{agent_slug, agent_id, task, position?}]`,
  `cross_review_pairs[{reviewer_slug, reviewee_slug}]`, `coordinator_agent_id`, `challenge?`,
  `anti_sycophancy?`. `parseTaskList(content)` is tolerant (`@slug: task` per line or fenced json),
  validated against the roster; **fallback** = deterministic round-robin of
  `["approach","implementation","risks"]` so execute never stalls.

### 4. Integrate / cross-review — collaborative, not one summarizer

`integrate` fans to all agents; each is assigned one peer's execute output (via
`cross_review_pairs`, round-robin) to confirm/flag/merge by slug. Genuine because the scoped query
now delivers the full execute thread.

### 5. Converge + attribution + anti-sycophancy (enforced in code)

- `detectChallenge(content)` (the live sibling of dead `conclusionDetected`): disagreement/risk
  patterns AND a peer-slug reference AND a proposed change. Stamped per reply.
- Before `converge`, orchestrator counts thread challenges. Zero → insert the `dissent` stage
  ("name the single weakest point + propose a fix; do not rubber-stamp"). `converge` is hard-gated
  after dissent. If still none, converge but stamp `anti_sycophancy:'no_challenge_after_dissent'`
  (auditable, never silent).
- `converge` composer is single-author but **composes, does not re-derive**: forbidden to add new
  substance; must emit an attribution block; orchestrator prepends a deterministic attribution
  header from `assignments`. If `< 2` distinct peers named → stamp `attribution_incomplete`.

### 6. `/debate` vs `/discuss` — real code+prompt distinction

`buildDiscussionStagePrompt(command, phase, prompt, assignment?)` branches on `command`:
- **discuss** — complementary sub-tasks; build/extend peers; cross-review+merge; attributed synthesis.
- **debate** — distinct opposing `position` per agent; defend hard; rebut a named rival; coordinator
  **adjudicates** (declares prevailing position + recorded dissent; does NOT merge).

### 7. Loop-guard / deliberation fix

Stop resetting deliberation fields: continuation runs set
`deliberation_root_id = original_message_id`, `deliberation_depth = stageNumber`, so a hand-off
inside a discussion still hits `max_agent_hops` + cycle detection. Per-stage fan-out ≤
`COLLAB_MAX_AGENTS = 3`; total real runs ≈ 1+3+3(+3)+1 = 8–11, under the ≤25 budget.

## Files to touch

| File | Change |
|---|---|
| `packages/shared/src/discussion.ts` (new) + `index.ts` | phase machine, `nextDiscussionStage`, `selectCoordinatorAgent`, `detectChallenge`, `parseTaskList`(+zod), `buildDiscussionStagePrompt`, constants, `ContextPacketV1` discussion fields, back-compat shim in `readDiscussionMetadata` |
| `bridge/src/lib/discussion-orchestrator.ts` | 5-stage machine; coordinator-vs-all targeting; parse plan → stamp assignments/cross_review_pairs/coordinator_agent_id; per-agent execute task; challenge query + conditional dissent; two ceilings; stop resetting `deliberation_*`; rename `selectConsensusAgent` |
| `bridge/src/context/build-context-packet.ts` | discussion-scoped peer query + self-echo filter; populate `coordinator_roster` when acting agent is coordinator |
| `bridge/src/context/context-window.ts` | `readDiscussionContextLimit()` + discussion char budget |
| `bridge/src/workers/run-worker.ts` | stamp `metadata.discussion` (+`challenge`) on each discussion reply; pass `triggerMsg.metadata` to `buildContextPacket` |
| `bridge/src/agents/format-roster.ts` | `formatFullRosterForCoordinator()`; render assigned task |
| `apps/web/lib/agent-targeting.ts` | discussion kickoff → coordinator-only for plan; export `selectCoordinatorAgent` |
| `apps/web/app/api/rooms/[roomId]/messages/route.ts` | kickoff: `phase='plan'`, target = coordinator, content = `buildDiscussionStagePrompt(command,'plan',prompt)` |
| `supabase/migrations/<ts>_discussion_team_workflow.sql` | **index-only**: `messages_discussion_thread_idx` on `(metadata->'discussion'->>'original_message_id')`; no column, no backfill |
| `docs/ARCHITECTURE.md` | document both state machines, blackboard, loop-guard math, anti-sycophancy gate |
| `packages/shared/test/discussion.test.ts`, `bridge/test/discussion-orchestrator.test.ts` | tests (below) |

## Migration — index-only (no column, no backfill, reuse the unique dedupe index).

## Test plan

- **shared unit:** `parseDiscussionRequest` routes /discuss /debate @everyone-?; `nextDiscussionStage`
  full discuss (incl. conditional dissent) + debate, `null` at end + budget ceiling;
  `selectCoordinatorAgent` determinism; `detectChallenge` corpus; `parseTaskList` happy/malformed/
  unknown-assignee; `buildDiscussionStagePrompt` differs by command; back-compat shim.
- **bridge orchestrator (mocked supabase):** peer visibility (execute packet contains a peer execute
  reply written *after* the trigger — the exact failing case today); `coordinator_roster` present iff
  coordinator+phase (leak test); decompose schedules one execute run per assignee with its task;
  anti-sycophancy (no challenge → dissent before converge; challenge → converge; debate skips
  dissent); termination (null at converge; ceilings → "concluded", no runs); idempotency (23505);
  deliberation carry-forward.
- **integration (mock adapter):** full /discuss + /debate; assert blackboard order plan→execute(×3)
  →integrate(×3)→converge; converge names ≥2 distinct peers with their parts; ≥1 challenge; runs ≤11;
  round_index 0..3(/4) then no more. Debate: distinct positions + adjudication (winner, not merge).
- **smoke (real CLI ≤25):** one real /discuss (converge names ≥2 peers + cites contributions); one
  real /debate (adjudication declares a winner).
- **regression:** typecheck 0; `supabase db reset` on the new migration; security invariants
  unchanged (shell:false, static argv, stdin-only packet, buildChildEnv strip, RLS, tool-approval,
  no browser writes).
