# Phase 11 critique — In-product slash commands + command registry + user-created agents

Date: 2026-05-31 · Branch: `harden/p11-commands-user-agents` · Base: Phase 10 HEAD (`0019452`)
Diff reviewed: commits `5f10803` + `2e488a0` (+ this critique-fix commit).

Gate: **security-auditor (MANDATORY) + code-reviewer**, run in parallel on the Phase 11 diff.

## Verdicts

- **security-auditor → PASS** (zero open Critical/High). All five hard gates verified
  with cited evidence:
  1. **system_prompt injection safety** — `buildArgs` is a static constant in both
     adapters; `system_prompt` is delivered only via `buildStdin`; `spawn(..., {shell:false})`;
     binary path resolved from trusted `*_BIN`/PATH, never agent data. `subprocess-security.test.ts`
     proves hostile metachars + an injected `--dangerously-skip-permissions` never reach argv.
  2. **Server-side RBAC** — `/reset` + `POST /api/agents` enforce `requireRoomAdmin` (member → 403);
     `PATCH/DELETE /api/agents/[agentId]` gate on `created_by_user_id === auth.uid()` (seeded
     NULL-owner agents and other users' agents are uneditable; strict `!==`).
  3. **No RLS / tool-approval bypass** — `tool_permissions` forced `{}` on create and not in
     `updateAgentSchema`; the bridge approval branch never consults `agents.tool_permissions`
     (gated on `event.requires_approval` + denylist); `agents` has no client write policy (RLS default-deny).
  4. **CSRF / rate-limit / validation** — present and consistent (one gap fixed, see below).
  5. **`/reset` data safety** — only stamps `context_reset_at` + inserts a notice; no DELETE; the
     context-builder lower bound is applied only when the watermark is set. Reversible.
- **code-reviewer → PASS** (zero Critical/High). Confirmed end-to-end wiring (every parsed command
  dispatched, `/pin` uses the correct API shape, `/help` uses the real fetched role), no parser
  regressions for `@mention`/`/discuss`/Phase 9–10 commands, correct `/reset` reorder, and that the
  new tests are meaningful (not coverage theater).

## Findings fixed in the critique-fix commit

- **[Medium] Missing rate-limit on agent PATCH/DELETE** (both critics) → added
  `enforceRateLimit('agent-mutate:<user>', 60/min)` in `requireAgentCreator`.
- **[Medium] Orphaned agent on room-attach failure** (code-reviewer) → on a non-23505 attach error
  the just-created agent is disabled (`is_active=false`) before returning, so create+attach is
  effectively all-or-nothing.
- **[Low] slug collision within a room** (security-auditor) → `POST /api/agents` now rejects a slug
  that already names an active agent member in the room (mention/hand-off resolve by slug in-room).
- **[Low] `avatar_url` unconstrained scheme** (security-auditor) → schema now requires `https://`.
- **[Low] unchecked `/reset` notice insert** (code-reviewer) → error is logged via the structured logger.
- **[Low] role-fetch race false pre-block** (code-reviewer) → client RBAC pre-check is gated on
  `roleLoaded` (the server remains the real gate).

## Deferred (logged to PROGRESS.md "For morning review")

- **[Medium] `agents.system_prompt` is readable by any authenticated user** via the pre-existing
  `agents_select` policy (`auth.uid() IS NOT NULL`, all columns). Phase 11 lets users author
  `system_prompt`, so this is worsened. Mitigated now with a UI caption ("don't put secrets in the
  system prompt"). A proper fix (column-level grant / view excluding `system_prompt`+`tool_permissions`,
  with a pgTAP test) interacts with PostgREST `select=*` behavior and cannot be verified against a
  live DB unattended — deferred to a dedicated security follow-up rather than risk breaking client reads.

## Local gate

typecheck ✓ · lint 0-err/9-known-warn ✓ · format ✓ · knip 0 ✓ · **bridge 140 / web 149** ✓ ·
`next build` compiled successfully, **0 Edge-runtime warnings**.
