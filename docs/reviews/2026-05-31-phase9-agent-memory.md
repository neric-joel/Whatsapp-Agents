# Phase 9 — In-product agent memory — critique review

**Date:** 2026-05-31
**Branch:** `harden/p9-agent-memory` (PR → `main`)
**Reviewers (parallel):** `security-auditor` (MANDATORY for Phase 9, adversarial) + `code-reviewer`
**Scope:** the Phase 9 memory feature commit (`agent_memory`/`user_profile` tables + RLS + FTS RPC, shared types + injection scanner, bridge persist/recall/format + run-worker wiring + adapter rendering, web `/remember`+`/recall` routes + parser + MemoryPanel).

## Verdicts

| Reviewer | Verdict | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| security-auditor | **PASS** | 0 | 0 | 0 | 5 |
| code-reviewer | **PASS** | 0 | 0 | 3 | 4 |

**Gate result: PASS — 0 open Critical/High.** The mandatory memory-safety gate (stored memory is DATA, never instructions) holds **structurally** and does not depend on the (intentionally best-effort, bypassable) scanner.

## Security auditor — key confirmations
- **Memory-injection escape: cannot.** Defense is structural, not scanner-dependent: `scanMemoryContent` collapses `\s{2,}`→space (kills multi-line fence breaks) and strips chat-template control tokens (`<|im_start|>`, `[INST]`, `<<SYS>>`, `</s>`) before storage; `formatMemoryForPrompt` prefixes **every** line with `> ` so no stored line can escape the quoted block, and a header explicitly frames the block as data to ignore on conflict. The real `CURRENT MESSAGE` fence sits after memory with its own delimiter.
- **RLS/authz: PASS.** Both tables RLS-on with **no** authenticated INSERT/UPDATE/DELETE policies → service-role writes only (matches the `agent_runs` invariant; proven by pgTAP). SELECT correctly scoped (room via `is_room_user_member`, agent-global via `can_read_agent_memory`, personal-global via `created_by_user_id = auth.uid()`). `recall_agent_memory` is `SECURITY INVOKER` + `REVOKE … FROM anon, authenticated` + `GRANT … TO service_role` — not callable by the browser.
- **SQL/FTS injection: none.** `p_query` is a bound parameter to `websearch_to_tsquery`; no string interpolation anywhere.
- **Privilege escalation: cannot.** `memory_op` has no `tool_permissions`/`system_prompt`/persona/approval field; `confidence` is only a recall sort key; replace/consolidate is `.eq('agent_id')`-scoped so an agent can't tamper with another agent's or a user's memory; recalled memory never reaches the tool-approval flow or argv.
- **Web routes: PASS.** Both mutating routes: CSRF (`assertSameOrigin`) + authn + membership + zod + redacted errors; PATCH ownership branch returns 403 for agent-global rows. No cross-resource IDOR.

### Low items (hardening; none gating)
1. Scanner is bypassable in isolation — **by design**; structural defense holds. (No change.)
2. PATCH had no rate-limit (POST did). **Fixed** — added `enforceRateLimit`.
3. PATCH lets any room member forget/pin shared room memory — accepted as group behavior; agent-global is protected.
4. `user_profile.details` not scanned on the (not-yet-existing) write path — noted for whenever a profile writer lands.
5. Size/DoS caps present and correct.

## Code reviewer — Mediums (addressed)
1. **`memory_op` worker path untested** → **Fixed**: added a `run-worker` integration test (adapter yields `memory_op` then `final_response`; a failing memory write still completes the run).
2. **`replace`/`consolidate` without `target_id` silently duplicated** → **Fixed**: now logs `memory.op.supersede_noop` so the no-op is observable; added a unit test.
3. **Budget cost ignores rendering overhead** → **Fixed (doc)**: clarified `applyMemoryBudget` bounds raw content only (soft budget).

### Low items (addressed / accepted)
- `/remember --global` stripped only the first flag → **Fixed** (global replace + test).
- `recallUserProfile` swallowed errors → **Fixed** (now logs `memory.user_profile.error`).
- MemoryPanel realtime is room-filtered so global notes weren't refreshed → **Fixed**: ComposeBox dispatches a panel refresh after a successful `/remember`.
- `queryText ?? ''` minor dead-defensiveness → left (harmless).

### Positives recorded by the reviewer
Resilience contract correct (invalid op skipped, RPC error/exception → `undefined`, run never broken); "always allow one entry" budget rule non-off-by-one; exhaustive `memory_op` switch; adapter consistency (claude/codex render via `formatMemoryForPrompt`, ruflo/myclaude inherit JSON packet); the red-team test is meaningful (builds the real adapter prompt); shared types coherent; no `any` in new code.

### Out-of-scope follow-up (filed, not fixed here)
- `AgentProvider` union lacks `'myclaude'` though `MyClaudeAdapter` + registry case exist (pre-existing; unrelated to memory).

## Post-fix verification
- typecheck ✓ · lint 0-err/8-warn (established `set-state-in-effect` pattern) ✓ · format ✓ · knip 0 ✓
- bridge tests **112** ✓ · web tests **129** ✓ · `next build` compiled successfully, 0 Edge-runtime warnings ✓
- DB migration + pgTAP RLS (`agent_memory_rls_test.sql`) run in CI (`db-tests.yml`).
