# AgentRoom Production Hardening — PROGRESS

Living log of the hardening effort (MVP → self-hostable, OSS-ready, v1.0). The
**single source of truth for the autonomous runner** — every iteration re-grounds from
this file + `CLAUDE.md` + git. `03_DEFINITION_OF_DONE.md` holds the box checklist.
Dates are absolute. **Base of record: `origin/main` (`f780235`).**

---

## Operating policy (standing)

- **Autonomy / continuous run.** Run `/goal` → `/loop` across phases without waiting.
  After a goal is DONE, set the next `/goal` (per `01_HARDENING_PLAN.md` +
  `04_HERMES_CAPABILITIES.md`) and continue. Leave a one-line heartbeat in the Night
  log per goal. Stop only when every DoD box is checked and `v1.0.0` is tagged, or when
  `docs/production-hardening/DONE.flag` exists.
- **NIGHT RULE (unattended until morning 2026-05-31).** Never stop to ask. On any
  blocker or ambiguous/expensive choice: take the **safe reversible path**, or **skip
  that item and log it under `## For morning review`**, then continue with the next
  thing. Keep a running `## Night log`.
- **FORBIDDEN (never; skip + log instead):** commit/force-push to `main`; delete data /
  drop tables; commit or rotate secrets. Everything else → feature branches + PRs.
- **Branch stacking.** While a phase's PR is unmerged (the human merges at breakfast),
  branch the next phase off the latest `harden/*`/`feat/*` branch (stack), and note it;
  rebase onto `main` after merges land.
- **Self-healing.** On ANY breakage (red typecheck/lint/test/build, failing stress test,
  CI failure, Critical/High critic finding): write a root-cause note here (symptom ·
  hypothesis · evidence), set a corrective `/goal` (`fix: …`), fix, re-verify until
  green. A goal is DONE only with passing checks + evidence + zero open Critical/High.
- **gh.** Authenticated as `neric-joel`. Use it for issues + one PR per phase.
- **Restart-safe.** `scripts/agent-runner.ps1` loops headless Claude (fresh state-load
  each iteration; redacts the gitignored `runner.log`; singleton mutex; sleeps ~5h on a
  usage limit; stops on `DONE.flag`). Stop = create `DONE.flag` or kill the runner. See `RUNNER.md`.
- **Security invariants (never weaken):** auth, RLS, tool-approval flow, subprocess
  validation, memory-injection scanning. `main` protected by GitHub branch protection +
  `.githooks/pre-push`.
- **Reuse assets** (`~/.claude` + `./.claude`): `security-auditor`/`code-reviewer` for
  critiques, `brainstorming` for features; note which asset each review used.
- **UI/UX (Phase 4):** research current best-in-class chat UI/motion (21st.dev + open
  resources); tasteful transitions honoring `prefers-reduced-motion` + WCAG AA; cite sources.

---

## PIVOT to origin/main — 2026-05-30 (night)

**Discovery:** the local checkout was **45 commits stale** (`7833573`); real
`origin/main` is `f780235` ("AgentRoom v2 complete" + Supabase auth/login/AuthGuard +
agent management + README/QUICKSTART + themes + stress tests + run cancellation + image
text extraction + math rendering). The earlier Phase-0 work + the captured "feature
wave" were built on the stale base and are **superseded**. Pivoted reversibly:

- **Backup:** `backup/pre-pivot-2026-05-30` @ `35ad8fb` (also on origin as
  `harden/p0-baseline-hygiene-ci`). Nothing lost.
- Reset local `main` → `origin/main`; new working branch **`harden/p0-foundation`**.
- **Salvaged (carried onto origin/main):** the hardening package only — `.github/**`
  (CI/security/dependabot/PR-template), `.editorconfig`, `.nvmrc`, `.gitattributes`,
  `.githooks/pre-push`, `scripts/agent-runner.ps1` + `register-task.ps1`,
  `.claude/commands/**` + `settings.json`, `docs/production-hardening/**`; merged
  `.gitignore`; re-applied `packageManager: pnpm@11.0.8`.
- **Discarded (stale duplicates / wrong on real code):** the product "feature wave"
  (login/members/agents routes, 4 panels, api-client, modified components/hooks,
  health change, `api.ts` deletion, config tweak). On `origin/main` `api.ts` is **live**
  and health already returns `{ service }`. Skipped redundant `apps/web/.eslintrc.json`
  (origin/main has an identical one) and `launch-agentroom.ps1` (origin has its own launchers).
- **Stale PR #3** (`harden/p0-baseline-hygiene-ci` → conflicting, no merge ref) is being closed.

---

## Phase 0 — foundation (re-grounded on origin/main) — 2026-05-30

**Baseline (real `origin/main` + carried infra), verified green:**
`pnpm install` ✓ · `typecheck` ✓ (after clearing a stale `.next/types` cache — self-heal,
not a code bug) · `lint` ✓ (3 non-blocking warnings → Phase 4) · `test` ✓ **110 passed**
(61 web vitest + 49 bridge node:test) · `pnpm --filter web build` ✓.
`origin/main` had **no `.github`/CI**, no `.editorconfig`/`.nvmrc`/`.gitattributes` — all
now added. Secrets: clean (fresh grep). Local Supabase Docker stack is **running**.

**Status:** foundation = the hardening infra `origin/main` lacked. PR: see Night log.
Branch-protection High (from the stale branch's critique) is resolved and still applies:
GitHub branch protection on `main` is live; `.githooks/pre-push` carried.

---

## Fresh audit on origin/main — 2026-05-30 (supersedes the stale-tree audit)

### Security surface (Phase 1) — `security-auditor`
Prior stale findings mostly **do not hold**: subprocess uses `spawn(cmd, args[])` (no
shell-string), service-role key is server-only/clean, RLS is read-only-correct (browser
cannot write `agent_runs`), run-claim is atomic, process-tree-kill on abort/timeout,
zod validation on all bodies, bridge logs redacted. **Real risks to fix in Phase 1:**
- **[High]** `subprocess-adapter.ts` `shell: process.platform==='win32'` + `claude-code-adapter.ts` pushes DB-controlled `system_prompt` into argv → Windows command injection. Fix: `shell:false` + resolve binary path; pass `system_prompt` via stdin.
- **[High]** Storage RLS scoped to `auth.uid() IS NOT NULL`, **not room membership** (`phase9_extensions.sql:39-56`) → any authed user can read/write any file in `agentroom-files` directly. Fix: scope to `is_room_user_member()` via the `rooms/{roomId}/…` path; add UPDATE/DELETE policies.
- **[Med]** No max-output cap on child stdout/stderr (OOM/DoS) → cap + kill.
- **[Med]** No CSRF/Origin check on cookie-authed mutating routes → add Origin allowlist or require Bearer.
- **[Med]** No rate limiting on writes (message POST fans out N subprocess runs) → per-user/room throttle.
- **[Med]** `middleware.ts` is fail-open (refreshes session, never enforces) → redirect unauthenticated on protected paths (keep API checks as defense-in-depth).
- **[Med]** OpenAI image-text egress (`file-context.ts`) is automatic + undocumented → document + make opt-in.
- **[Low]** Raw Supabase `error.message` leaked on 500s; signed-upload no MIME allowlist; denylist bypassable (tool-exec is still a stub).

### Standards / OSS — `Explore`
Present now (added): CI/security/dependabot/PR-template, editorconfig, nvmrc, gitattributes, pre-push, README, QUICKSTART. **Still missing:** `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`, `CODEOWNERS`, `.github/ISSUE_TEMPLATE/`, `docs/ARCHITECTURE.md`, `docs/adr/`, `docs/SELF_HOSTING.md`, Dockerfile/compose/.devcontainer. tsconfigs: `strict:true` everywhere but no `noUncheckedIndexedAccess`/shared base (Phase 2). Env fully documented (incl. optional `OPENAI_API_KEY`/`OPENAI_VISION_MODEL`). README/QUICKSTART = local-Docker Supabase, ~15 min.

### "User-created agents" re-scope (Phase 11)
Already exists: list global agents; add/remove/mute **seeded** agents per room (`/api/rooms/{roomId}/members` + RoomHeader UI). **Gap to build:** create/edit/disable **new** agents — `POST/PATCH/DELETE /api/agents`, `createAgentSchema`/`updateAgentSchema`, a "Create agent" form (name/slug/avatar/provider/adapter_type/model/system_prompt/capabilities/reply_policy), `created_by_user_id = auth.uid()`, admin+ gating. DB + RLS already support it. ⚠ Couples to the Phase-1 `system_prompt` injection fix (don't let a user-set `system_prompt` reach a shell).

---

## Re-grounded backlog (what's left on top of origin/main)
| Phase | Already on origin/main | Remaining work |
|---|---|---|
| 0 Foundation | — | CI/configs/docs (this branch) → PR + merge |
| 1 Security | spawn args[], RLS reads, atomic claim, zod, redaction | shell:false, storage-RLS room scope, output cap, CSRF, rate-limit, fail-closed mw, doc OpenAI egress, headers, error redaction, MIME allowlist |
| 2 Quality | strict TS, eslint(web) | root ESLint+Prettier, `noUncheckedIndexedAccess`, bridge/shared real lint, knip dead-code, shared base tsconfig |
| 3 Testing | 110 tests, stress-test-agents.ts | coverage floor in CI, Playwright e2e, RLS/policy tests, run stress hard (needs Docker) |
| 4 UI/UX | themes, auth UI | a11y WCAG AA, loading/empty/error states, motion (21st.dev), responsive, design tokens |
| 5 DX/Docker | README/QUICKSTART, launchers | Dockerfiles + compose + devcontainer, env validation at boot, SELF_HOSTING.md |
| 6 Observability | redaction, health route, heartbeat | structured logging, error tracking (opt-in), reliability/chaos |
| 7 Docs/OSS | README | LICENSE/CONTRIBUTING/SECURITY/CoC/CHANGELOG/CODEOWNERS/ARCHITECTURE/ADRs |
| 8 Release | — | CHANGELOG, v1.0 tag, release workflow |
| 9 Memory | — | agent_memory + user_profile (FTS, injection-scanned) |
| 10 A2A | discuss/loop guards/tag-turns | roster in context, /handoff, cycle detection |
| 11 Commands + user-agents | add/remove/mute seeded agents | command registry + RBAC; **create new agents** (the gap above) |

---

## Night log
- **2026-05-30 ~00:00** — Installed workflow commands; ran Phase 0 audit (stale tree); built CI/runner/docs; opened PR #3 (later found stale).
- **2026-05-30 ~01:1x** — Critique gate found "main unprotected under runner" (High) → enabled GitHub branch protection on `main` + committed `.githooks/pre-push`.
- **2026-05-30 ~01:2x** — **Discovered local checkout 45 commits stale.** Paused, confirmed with the owner.
- **2026-05-30 (night)** — **Phase 1 (Security) complete.** On `feat/p1-security` (stacked on `harden/p0-foundation`): subprocess sandbox (shell:false, stdin system_prompt, bin allowlist, env min, output cap, +10 tests); storage RLS scoped to room membership (new migration + pgTAP + live-DB rolled-back verify 6/6); CSRF/Origin + rate limiting + fail-closed middleware + security headers/CSP + 16 error-redactions + MIME allowlist + OpenAI egress opt-in (+15 web tests). Verified green: typecheck/lint/test (**135**)/build; client bundle has no service-role key. Critique gate (security-auditor + code-reviewer) → **PASS**, no Critical/High; Mediums M-1/CR-1/CR-3 fixed inline, L-1 deferred → `docs/reviews/2026-05-30-phase1-security.md`. Local Supabase: the live stack runs under project-id `agent-room` (db:54322); `supabase start` for `Whatsapp-Agents` hit a port clash — did NOT disturb the running stack; verified migration/RLS against it inside rolled-back txns only. PR #5 opened. NEXT: set Phase 2 goal (quality/dead-code) stacked on this branch.
- **2026-05-30 (night)** — Owner approved pivot + unattended mode. Snapshot `backup/pre-pivot-2026-05-30`. Reset to `origin/main`; branch `harden/p0-foundation`; carried the hardening package; discarded stale product duplicates. Fresh audits on the real code (security + standards + agent-mgmt re-scope). Baseline green (110 tests). Unattended scaffolding written (settings.local.json, sleep prevention, runner). NEXT: close PR #3, push foundation + PR, launch overnight runner → runner drives Phase 1+.

---

## For morning review
- **Merge order:** review/merge the **Phase 0 foundation PR** first (on `origin/main`), then the stacked phase PRs the runner opens overnight. Stacked branches rebase onto `main` after each merge.
- **Stale PR #3** (`harden/p0-baseline-hygiene-ci`) — closed as superseded by the pivot; verify.
- **Docker/Supabase:** local stack is up; Phase 3 e2e + `pnpm stress:agents` (hard) run only while Docker is up. If it goes down overnight, those are queued here.
- **`next@14→15` upgrade** (6 high `pnpm audit` advisories) — breaking; its own PR + ADR (decision D3). CI audit job is informational until then.
- **Runner caveats:** uses `--dangerously-skip-permissions` (unattended); `runner.log` is gitignored + redaction-filtered but is local plaintext — treat as sensitive. The Startup-folder launcher (`%APPDATA%\…\Startup\agentroom-harden.cmd`) auto-resumes at logon (mutex prevents double-run); remove it to fully disable.
- **`scripts/register-task.ps1`** (full logon+5h scheduled task) needs ONE elevated run — optional (Startup launcher + the running loop already cover continuity).
- **Decisions recorded:** D1 pivot to origin/main; D2 gh now authed; D3 defer next@15; D4 runner = owner's spec prompt + safety wrappers (mutex/redaction).

---

## 2026-05-30 — GOAL: Phase 1 — Security hardening (real base) — **DONE ✅**
- Phase: 1 (Security). Branch: `feat/p1-security` (stack on `harden/p0-foundation`). PR: #5 (see Night log).
- Iteration budget: 10. State: **DONE** (judge-gated: both critics PASS, no open Critical/High, all checks green).
- Acceptance criteria (testable; from the fresh audit):
  - [x] Subprocess: `shell:false` unconditionally; `system_prompt` never enters argv with a shell; binary path resolved/allowlisted; child env minimized (no service-role key forwarded). Bridge tests green (59); `shell:true` removed. → `bridge/src/lib/subprocess-security.ts`, `subprocess-adapter.ts`, `claude-code-adapter.ts` + 10 unit tests.
  - [x] Storage RLS scoped to room membership (read + insert + update + delete) via `is_room_file_member()`→`is_room_user_member()`; policy test + live-DB rolled-back verification (6/6 assertions). → `supabase/migrations/20260530000001_storage_room_rls.sql`, `supabase/tests/storage_rls_test.sql`.
  - [x] Child stdout/stderr output cap (10 MB → kill + error). → `subprocess-adapter.ts` `getMaxOutputBytes`.
  - [x] CSRF/Origin defense on all mutating API routes (central in `middleware.ts` + inline on messages/signed-upload; Bearer exempt). Tests prove cross-origin POST + missing-Origin rejected. → `lib/api-security.ts`.
  - [x] Rate limiting on message POST (30/min) + signed-upload (20/min) per user+room. → `lib/api-security.ts` + 3 tests.
  - [x] `middleware.ts` fail-closed for protected paths (redirect unauthenticated → `/auth`); API 401s remain.
  - [x] OpenAI image-text egress documented + opt-in (`ENABLE_IMAGE_TEXT_EXTRACTION`, off by default). → `bridge/src/context/file-context.ts` + `.env.example`.
  - [x] Security headers (CSP/HSTS/X-Content-Type-Options/X-Frame-Options/Referrer-Policy/Permissions-Policy; frame-ancestors none) via `next.config.mjs`.
  - [x] 5xx responses return generic errors (raw logged server-side only) — 16 sites redacted across 10 routes; signed-upload MIME allowlist + 25 MB cap + traversal guard. → `lib/api-validation.ts`, `lib/api-security.ts internalError`.
  - [x] Critique gate (Security Auditor + Code Reviewer) **PASS**, saved to `docs/reviews/2026-05-30-phase1-security.md`; no open Critical/High; `typecheck`/`lint`/`test` (135)/`build` green. Mediums M-1/CR-1/CR-3 fixed; L-1 deferred to Phase 2.

Judge rule: DONE only when every box is checked with linked evidence and no Critical/High is open. **Met.**
