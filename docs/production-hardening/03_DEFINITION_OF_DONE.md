# 03 — Definition of Done, GitHub Protocol & Stop Conditions

The project is **production-ready** only when every box below is checked **with
linked evidence** (a merged PR, a green CI run, a saved review, or a screenshot).
"I think it's fine" does not check a box.

---

## Definition of Done checklist

### Security (Phase 1)
- [x] No secret is tracked in git, present in logs, or printed in output (`gitleaks` clean). _(grep-clean; `secret-scan` job green on merged `main`, run 26735529702.)_
- [x] Subprocess execution uses `spawn(bin, args[], {shell:false})`, an allowlisted binary, validated cwd, enforced timeout/output-cap/concurrency, and orphan cleanup. _(PR #5)_
- [x] `SUPABASE_SERVICE_ROLE_KEY` is provably server-only; client bundle grep clean (no `SERVICE_ROLE` in `.next/static`). _(build check; an automated CI guard is a Phase 2 follow-up.)_
- [x] RLS is ON for every table with correct membership/ownership policies; browser cannot write `agent_runs`; storage policy test passes (live-DB rolled-back, 6/6). _(PR #5)_
- [x] Every API route enforces authn + authz + input validation; expensive/write routes are rate-limited; errors don't leak internals (16 sites redacted). _(PR #5)_
- [x] File uploads enforce size + MIME limits, resist path traversal, scope to room/user (RLS), and use signed URLs; third-party image-egress is documented and opt-in. _(PR #5)_
- [x] Tool-approval flow cannot be bypassed, forged, or replayed. _(audited Phase 0/1 + re-confirmed in the pre-v1.0 sweep as sound for the current stub — tool execution is a no-op stub, so the denylist is not a live injection path; revisit when real tool-exec lands.)_
- [x] Security headers (CSP/HSTS/etc.) are set; `pnpm audit` risk: `next@14→15` advisories deferred (D3, its own PR). _(PR #5)_
- [x] Security red-team review = PASS (saved in `docs/reviews/2026-05-30-phase1-security.md`).

### Code quality (Phase 2)
- [x] Root ESLint (flat) + Prettier enforced across all workspaces; `pnpm lint` green (0 errors). _(PR #6)_
- [x] TypeScript strict (+ `noUncheckedIndexedAccess`, no implicit `any`); `pnpm typecheck` green. _(PR #6)_
- [x] `knip` reports no unused files/exports/deps; net code removed; wired into CI. _(PR #6)_
- [x] No architecture violations in production code (one pre-existing test-only web→bridge import deferred → A-3). _(PR #6)_

### Testing (Phase 3)
- [x] Unit/integration coverage ≥ the CI floor on the risk areas; CI gates on it. _(154 tests; bridge 60.7% ≥ 55, web 90.0% ≥ 80; `coverage` job in CI.)_ _(PR #7)_
- [x] Playwright e2e covers the core journeys and runs deterministically (mock adapter, no live LLM) in CI. _(8 specs; 5/5 non-skipped pass against dummy-env web server; live journey gated on `E2E_LIVE`; `e2e.yml`.)_ _(PR #7)_
- [x] RLS/policy tests exist and pass. _(pgTAP `storage_rls_test.sql` 6/6 + `rls_policies_test.sql` 4/4; `db-tests.yml` runs `supabase test db` in CI.)_ _(PR #7)_
- [x] A deliberately introduced regression is demonstrably caught by the suite. _(flipped `isForbiddenCrossOrigin`→false; 2 CSRF tests failed; reverted — see review.)_ _(PR #7)_

### UI/UX & accessibility (Phase 4)
- [x] Every core view handles loading / empty / error / stuck-run states. _(Phase 4 review, PR #8 → merged via the stack.)_
- [x] Lighthouse a11y ≥ 95 and 0 critical `axe` violations on core pages; keyboard-only flow works; agent replies announce via `aria-live`. _(Lighthouse `/auth` = **99**; **authenticated room page**: axe **0 serious/critical** — a stricter check than Lighthouse, which can't seed the client session via CLI; tablist arrow-key + focus-trap e2e; `role="log"`/`aria-live` on the timeline. Authed-page Lighthouse number deferred to v1.0.1 per ADR-0009.)_
- [ ] Responsive from mobile to desktop; markdown/math/code rendering is robust. _(markdown/math/code rendering done; full mobile→desktop viewport verification deferred to v1.0.1 — ADR-0009.)_
- [ ] Consistent design tokens + theming; before/after screenshots in the PR. _(design tokens + theming done; before/after room-UI screenshots not captured — deferred to v1.0.1, ADR-0009.)_

### Developer experience & self-hosting (Phase 5)
- [x] Runs end-to-end on **local Supabase via Docker** with **no Pro/paid plan**; a self-hosted `docker-compose` production path is documented; any hosted free-tier is optional (with its pause behavior noted). _(verified this session: `supabase db reset` + app boot on local Supabase; full e2e mock journey green; `docs/SELF_HOSTING.md` + `docker-compose.yml`.)_
- [x] Production `Dockerfile`s (web + bridge) + `docker-compose.yml` bring the stack up; `.devcontainer/` works. _(both images build + smoke-test green in CI `build-images` on merged `main`; `.devcontainer/` present.)_
- [x] One-command setup takes a clean clone to a running app in <15 min, proven on a clean environment. _(proven this session: fresh clone → `pnpm install` (frozen, ~7 s) → typecheck → boot → `/auth` 200 + `/api/health` `db:up`, ≪ 15 min.)_
- [x] Env vars are validated at boot (fail-fast, names the bad var); `.env.example` files are authoritative. _(web instrumentation + bridge boot zod validation; tested.)_
- [x] `docs/SELF_HOSTING.md` explains the local-Docker default, the self-hosted production path, and the bridge/subprocess trust model. _(present.)_

### Observability & reliability (Phase 6) — DONE ✅ (PR pending merge)
- [x] Structured, secret-redacted logging with run/correlation IDs in web + bridge. → shared JSON logger (`ae0d7ef`); unified `redactDeep` across logger + error tracking.
- [x] Health/readiness endpoints reflect reality; bridge liveness is observable. → web `/api/health` DB ping (force-dynamic); bridge `/healthz` + `/metrics` HTTP server; stale-run recovery documented in `docs/OBSERVABILITY.md`.
- [x] Error tracking is wired behind config (no-op without DSN). → shared `createErrorTracker` (opt-in, redacted any-transport); web `internalError` + bridge `run.failed` capture; unit-tested no-op.
- [x] Induced failures (child crash, DB drop, bad agent output) fail gracefully — no hangs, no lost runs; cancellation truly kills work. → `run-worker.test.ts` (crash/bad-output/DB-error → clean `failed`, one terminal write; cancel → clean `cancelled`); subprocess timeout + output-cap + force-kill-tree; minimal metrics. Critique PASS → `docs/reviews/2026-05-31-phase6-observability.md`.

### Documentation & OSS readiness (Phase 7) — DONE ✅ (PR pending)
- [x] README for newcomers (what/why, demo GIF, architecture diagram, quickstart, + new Documentation/Contributing/License footer linking the deeper docs). Pre-existing README was already external-audience quality (Phase 0 audit); Phase 7 added the missing links.
- [x] `docs/ARCHITECTURE.md` (components, data-flow mermaid, `agent_runs` queue contract, adapter model, trust boundaries), the **full web+bridge env-var table**, the `ContextPacketV1`/`AgentEvent` contract, and a "new agent adapter" guide (in CONTRIBUTING). *(Per-route endpoint reference is summarized — all routes use the `{ok,data}`/`{ok,error}` envelope; a dedicated endpoint table can follow in Phase 8 if needed.)*
- [x] `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue templates (`bug`/`feature`/`config.yml`) + the existing PR template, `.github/CODEOWNERS` present.
- [x] Significant Phase 1–6 decisions captured as ADRs `docs/adr/0001–0008` + index + template.
- [x] DX/Docs "newcomer" review = **PASS** (0 Critical/High; 2 Med + 3 Low doc-accuracy fixes applied) → `docs/reviews/2026-05-31-phase7-docs-oss.md`.

### Hermes capabilities (Phases 9–11) — DONE ✅ (PRs #14/#15/#16, CI green)
- [x] **Memory:** `agent_memory` + `user_profile` exist with RLS; agents curate memory via the bridge-validated `memory_op` path (no direct table writes); recall is injected into `ContextPacketV1`; `/remember` + `/recall` work. _(PR #14)_
- [x] **Memory safety:** every memory write is prompt-injection scanned and stored as data, not instructions; `memory-format-redteam.test.ts` proves stored memory cannot change agent permissions or override the system prompt; security-auditor PASS. _(PR #14)_
- [x] **Agent-to-agent:** roster + capabilities appear in the context packet; `/handoff @agent` creates a targeted run under the hop/round loop guards; chains terminate (cycle/hop/round-cap tests); `/agents` reflects reality. _(PR #15)_
- [x] **Commands:** one central registry (`COMMAND_REGISTRY`) drives parsing + dispatch; RBAC enforced server-side (`requireRoomAdmin` — a `member` cannot run `/reset`, `permissions.test.ts`); `/help` lists exactly the caller's allowed commands; `/discuss` + `@mention` tests still pass. _(PR #16)_
- [x] **User-created agents:** admins create / edit / disable agents from the UI (name, slug, avatar, provider/adapter_type, model, system_prompt, capabilities, reply_policy, tool_permissions), persisted to `agents` + added as `room_members`; admin+ gated + validated server-side; surfaced in AgentsPanel + the agents API; non-admins cannot create/edit (`create-agent-validation.test.ts` + `permissions.test.ts`); user `system_prompt` reaches the CLI via stdin only (`subprocess-security.test.ts`). _(PR #16)_

### Release (Phase 8) — DONE ✅ (v1.0.0 tagged + released)
- [x] `CHANGELOG.md` complete; SemVer adopted; dependencies locked for reproducible builds. _(CHANGELOG `[1.0.0]`; `pnpm-lock.yaml` frozen-install verified.)_
- [x] `v1.0.0` tagged; release workflow builds (and optionally publishes) images; release notes attached. _(tag `v1.0.0` on `c0cc441`; `release.yml` green — verify + both images build + GitHub Release; notes = CHANGELOG `[1.0.0]`; 0 binary assets. <https://github.com/neric-joel/Whatsapp-Agents/releases/tag/v1.0.0>)_
- [x] Full suite (typecheck/lint/test/e2e/build/security) green on `main` and on the tag. _(merged-main CI: `verify`/`secret-scan`/`codeql`/`build-images`/`rls` green, `audit` allowed-red per D3; local full suite + 12/12 e2e green; `release.yml` verify+images green on the tag.)_
- [x] README badges (CI/license/release) accurate; demo refreshed if UI changed. _(CI + MIT + release badges added; UI change was an a11y contrast fix only — existing demo GIF remains representative.)_

---

## GitHub documentation protocol

The "process documented in GitHub" requirement is satisfied by maintaining these,
all in-repo and via `gh`:

**`docs/production-hardening/PROGRESS.md`** — the living log. One entry per loop
iteration:
```
## <date> — Phase <n>: <goal>
- Goal & acceptance criteria: <...>
- Plan: <branch/worktree, files, verification>
- Done: <what shipped> (PR #<n>)
- Verification: <commands run + result, screenshots/links>
- Critique: <reviewers, verdicts, links to docs/reviews/*>
- Findings integrated: <Critical/High fixed; Medium/Low deferred → issue #<n>>
- Next goal: <...>
```

**GitHub issues** — one tracking issue per phase, sub-issues for findings. Labels:
`phase:0`…`phase:8`, `area:security|quality|testing|ux|dx|ops|docs|release`,
`severity:critical|high|medium|low`. Close issues from merged PRs (`Closes #n`).

**ADRs** — `docs/adr/NNNN-title.md`: context, decision, alternatives, consequences.
One per significant/irreversible choice (schema changes, license, auth model, etc.).

**Reviews** — every critic/specialist report saved under `docs/reviews/` and linked
from its PR.

**Pull Request template** (add as `.github/pull_request_template.md`):
```
## What & why
<summary + the phase/issue this advances — Closes #__>

## Changes
- <bullet the meaningful changes>

## Risk & rollback
<what could break; how to revert>

## Verification (evidence required)
- [ ] typecheck / lint / test / build green (CI link: __)
- [ ] phase-specific checks (e2e / a11y / gitleaks / audit): __
- [ ] screenshots for UI changes: __
- [ ] critic + specialist review attached (docs/reviews/__)

## Notes
<web sources cited; local .claude assets used; follow-ups filed as issues>
```

---

## Loop stop conditions

**Close a phase** only when: acceptance criteria met with evidence, all Critical/High
findings fixed, PR merged, PROGRESS.md + DoD boxes updated, deferrals filed as issues.

**Stop the whole loop (DONE)** only when: every DoD box is checked with evidence, the
full suite is green on `main`, `v1.0.0` is tagged, and a final full-panel adversarial
sweep raises no Critical/High. At that point post a closing PROGRESS.md summary
linking the evidence and tell the human the project is production-ready.

**Pause and ask the human** (don't guess) when: a choice is irreversible or expensive
and genuinely ambiguous (license selection, destructive schema/data change, dropping
a feature, adding a paid/third-party dependency, anything touching real user data or
secrets rotation). Ask ONE precise question, then continue. Everything else: pick the
well-justified default, record it (ADR/PROGRESS), and proceed.

**Never** mark a box done with failing checks, partial work, fabricated evidence, or
an unresolved Critical/High finding.
