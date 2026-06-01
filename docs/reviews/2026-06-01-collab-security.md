# Security Review — ADR-0011 `/discuss` team collaboration (`/critique security`)

Date: 2026-06-01 · Scope: `git diff feat/product-validation-v1...HEAD` (data-exposure + injection focus).

## Triage + disposition

| SEV | Title | Where | Exploit / data-flow | Disposition |
|---|---|---|---|---|
| **HIGH** | Client can self-stamp `metadata.discussion` on a normal message → discussion-scoped context query honors a forged `original_message_id` | `api-validation.ts:23` (unconstrained `metadata`) + messages `route.ts` (spread client meta first) → `build-context-packet.ts` (scoped `.or()`) | A non-/discuss message with `metadata.discussion={enabled,phase,original_message_id:<other-thread-root>,original_prompt}` passed `readDiscussionMetadata` and made the bridge load **another in-room discussion's** transcript (≤24 msgs) into the agent's context. Cross-room is blocked by `.eq('room_id',…)`; within-room cross-thread disclosure + extra agent_runs were real. | **FIXED** (commit 7ef7e9e): `stripServerOwnedMetadata()` — server is sole author of `discussion`; route re-adds a trusted block only for a real request. 3 unit tests. |
| **MED** | Same forgery advances the orchestrator → unbounded extra agent_runs (fan-out amplification) | `run-worker.ts` (orchestrator runs on every completed run) | A forged `phase:'plan'` trigger kicks off a multi-phase, multi-agent cascade the user never paid the `/discuss` accounting for (bounded by ABS_MAX_DISCUSSION_ROUNDS). | **FIXED** — folds into the HIGH fix (no forged discussion block survives). |
| LOW | `original_message_id` interpolated raw into the PostgREST `.or()` filter | `build-context-packet.ts` | With the HIGH fix, `discId` is always a server UUID. Even pre-fix, the top-level `.eq('room_id')` ANDs with the `.or()` group so cross-room escape was NOT achievable. | **FIXED (defense-in-depth)** — hard UUID-validate `original_message_id` before the filter; non-UUID falls back to the normal context path. |

## SURVIVES (attacks that failed, with evidence)

- **Room isolation** — the discussion-scoped query keeps `.eq('room_id', run.room_id)`; PostgREST ANDs it with the `.or()` group, so an agent can never pull another room's messages. The `context_reset_at` watermark is carried into the discussion branch too.
- **`challenge` flag cannot be spoofed** — run-worker computes `detectChallenge(replyContent)` server-side over the agent's own text (not copied from the trigger); the gate reads `challenge:true` only on `sender_type='agent'` rows, which only the service-role bridge can write (RLS). A user cannot force-skip the dissent stage.
- **Migration index re-scope is safe** — `messages_discussion_phase_unique` narrowed to `sender_type in (system,user)` still blocks duplicate phase *triggers* (only the server writes those); agent replies legitimately repeat a phase string N times. Idempotency preserved.
- **All untouched invariants hold** — spawn `shell:false`, static argv, stdin-only `ContextPacketV1`, `buildChildEnv` secret-strip, RLS write-isolation (browser never writes `agent_runs`/`messages`), tool-approval, WS2 credential handling. This diff touches no adapter/subprocess/credential code. The new query widens the bridge's row set within a room (drops the time ceiling, ≤24, watermark-gated) — intended for peer visibility; the actual threat was the web write-path trust, now closed.

Verdict: **safe to merge** after the HIGH fix (shipped).
