# AgentRoom Production Hardening — PROGRESS

Living log of the hardening effort (MVP → self-hostable, OSS-ready, v1.0). One entry
per loop iteration. Authoritative status lives here; `03_DEFINITION_OF_DONE.md` holds
the box checklist. Dates are absolute.

Conventions: each goal is judge-gated — DONE only when every acceptance criterion is
checked **with linked evidence** and no Critical/High review finding is open.

---

## Operating policy (standing — added 2026-05-30)

Authorized by the project owner for the remainder of this effort:

- **Autonomy / continuous run.** Run `/goal` → `/loop` across phases 0–11 without
  waiting for approval. After a goal is DONE, immediately set the next `/goal` (per
  `01_HARDENING_PLAN.md` + `04_HERMES_CAPABILITIES.md`) and continue. Leave a one-line
  heartbeat here after each goal instead of stopping. Stop only when every DoD box is
  checked and `v1.0.0` is tagged, or when `docs/production-hardening/DONE.flag` exists.
- **When to pause (rare).** ONE precise question only if a decision is irreversible AND
  expensive AND genuinely ambiguous (destructive data loss, license choice, dropping a
  feature). Otherwise pick the best-justified default, record it here, and proceed.
- **Standing batch approval.** Pre-approved reversible batches: removing `do/*`
  worktrees, deleting only-merged `do/*` branches (report unmerged, never force),
  pruning dead remote branches, committing existing uncommitted work onto a `harden/*`
  branch. `main` stays protected — branches + PRs only. Never commit secrets.
- **gh.** GitHub CLI is installed + authenticated → use it for the tracking issue and all PRs.
- **Self-healing.** On ANY breakage (red typecheck/lint/test/build, failing stress test,
  CI failure, Critical/High critic finding): do not stop. Write a root-cause note here
  (symptom · hypothesis · evidence), set a corrective `/goal` (`fix: <root cause>`),
  implement, re-verify until green. A goal is DONE only with passing checks + evidence
  + zero open Critical/High.
- **Restart-safe.** `scripts/agent-runner.ps1` + Windows Scheduled Task `AgentRoomHarden`
  re-launch the headless loop at logon and every 5h, sleeping through usage-limit
  windows. Stop = create `DONE.flag` or `schtasks /End /TN AgentRoomHarden`. See `RUNNER.md`.
- **Stress testing (Phase 3+).** Expand `pnpm stress:agents`; cover concurrent
  rooms/agents, queue saturation, long `/discuss`, deep hand-off chains (prove loop
  guards), many/large uploads, stale-run recovery, cancellation under load. Metrics →
  `docs/reviews/stress-*.md`. Fix every failure via the self-healing loop. Needs Docker.
- **UI/UX (Phase 4).** Research current best-in-class chat UI/UX + motion (21st.dev and
  other open/free resources); implement tasteful transitions honoring
  `prefers-reduced-motion` + WCAG AA; adapt (never copy proprietary); cite sources in the
  Phase 4 review/ADR.
- **Reuse assets.** Use `~/.claude` + `./.claude` agents/skills throughout
  (`security-review`/`security-auditor` for P1, `code-review`/`code-reviewer` for
  critiques, `brainstorming` for features); note which asset each review used.
- **Security invariants (never weaken).** auth, RLS, tool-approval flow, subprocess
  validation, memory-injection scanning. No secrets in git/logs/PRs.

---

## 2026-05-30 — Phase 0 baseline audit (`/audit`)

Read-only reconnaissance. No code changed. Findings below seed the Phase 0 goal and
map to the backlog in `01_HARDENING_PLAN.md`.

### Environment / tooling
| Tool | State | Impact |
|------|-------|--------|
| `gh` (GitHub CLI) | **NOT installed** (not on PATH, not in Program Files) | Cannot auto-create issues/PRs. Fallback: `git push` + paste-ready blocks (see `GITHUB_ISSUES.md`). Installing `gh` (`winget install GitHub.cli`) would restore full automation. |
| Docker daemon | **DOWN** (client v28.4.0 present; Desktop Linux engine pipe absent) | `pnpm dev:supabase` / `supabase start` cannot be smoke-tested until Docker Desktop is started. Not blocking for P0 (hygiene/CI/lint/typecheck need no DB). Required for the Supabase-local smoke + Phase 3 e2e + Phase 5. |
| Supabase CLI | v2.98.2 (v2.102.0 available) | OK; update is non-blocking. |
| Remote | `git@github.com:neric-joel/Whatsapp-Agents.git` (SSH) | Push works. |

### Baseline check status (run 2026-05-30 against the current dirty tree)
| Check | Result | Evidence |
|-------|--------|----------|
| `pnpm typecheck` | ✅ PASS | 3 workspaces (web, bridge, shared) `tsc --noEmit` clean, incl. uncommitted code |
| `pnpm --filter web build` | ✅ PASS | `next build` ok; 17 routes compile (incl. `/login`, `/api/agents`, `/api/rooms/[roomId]/members`) |
| `pnpm test` | ✅ PASS | vitest: 3 files / 14 tests pass (web only; bridge & shared have **no tests**) |
| `pnpm lint` | ⚠️ NOT CONFIGURED | `apps/web` has no ESLint config; `next lint` would prompt interactively → effectively unconfigured. Phase 0 will add a minimal config; Phase 2 unifies at root. |
| `pnpm audit` | ⚠️ 18 vulns (6 high / 10 moderate / 2 low) | Almost all `next@14.2.35` (patched only in 15.x → major upgrade) + dev-only transitives (`glob`, `brace-expansion` via eslint) + patchable `postcss`/`ws`. |

### Secrets — CLEAN ✅
- No secret tracked; none in git history (only `f2fb917` added `*.env.example` placeholder files, values blank).
- Real `apps/web/.env.local` (438B) + `bridge/.env` (458B) exist on disk, correctly **untracked** (`.gitignore` has `.env`, `.env.local`).
- No `SERVICE_ROLE`/secret in any `NEXT_PUBLIC_*` var. `SUPABASE_SERVICE_ROLE_KEY` referenced only in `apps/web/lib/supabase/server.ts` (server-only) and `bridge/src/lib/supabase.ts`.

### Working tree — one coherent uncommitted feature wave
`main` has **11 untracked + 11 modified** files forming a single "agent-room management"
change-set (login, agents/rooms/members APIs, 4 panels, api-client). Verified
**load-bearing, no broken imports, builds green** → capture in the P0 branch (see
`docs/reviews/phase-0-untracked-loadbearing.md`). EXCEPTION: do **not** commit the
health-route regression as-is (restore the documented contract first).

### Repo hygiene debt
- 7 stale worktrees in `.worktrees/do-*` + 7 local `do/*` branches + remote `origin/do/0509-6csl`.
- `.gitignore` (11 lines) does not cover `.worktrees/`, `graphify-out/`, `.claude/do-tasks/`, `next-env.d.ts`.
- `.claude/do-tasks/` (17 `/do` task files) + `graphify-out/` (generated) should be ignored, not committed.

### Findings → backlog map
| # | Finding | Sev | Phase | Source |
|---|---------|-----|-------|--------|
| 1 | No CI (`.github/workflows` absent) | High | 0 | standards |
| 2 | Stale worktrees/branches; gitignore gaps | Info | 0 | hygiene |
| 3 | `launch-agentroom.ps1` hardcodes `$REPO` machine path (no secret) | High | 0/5 | `launch-agentroom.ps1:1` |
| 4 | Dead `apps/web/lib/api.ts` (superseded by `api-error.ts`) | High | 0/2 | dead-code |
| 5 | Health route regressed: returns `{ok:true}`, missing `data.service` | Med | 0 | `health/route.ts:4` |
| 6 | Missing LICENSE/CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/CHANGELOG/README | High | 0/7 | standards |
| 7 | **Subprocess `shell:true` on win32 + `system_prompt` arg → command injection** | High | 1 | `subprocess-adapter.ts:27` |
| 8 | No child output-size cap (unbounded stdout/stderr → memory DoS) | High | 1 | `subprocess-adapter.ts:34-35` |
| 9 | Full `process.env` forwarded to child → service-role key leaks to agent CLIs | Med→High | 1 | `subprocess-adapter.ts:25` |
| 10 | `*_BIN` not allowlisted; child `cwd` not set/validated (runs in repo root) | Med | 1 | adapters / `subprocess-adapter.ts` |
| 11 | Denylist substring-match bypassable; guards a stubbed execution path | Med | 1 | `bridge/src/lib/denylist.ts` |
| 12 | Supabase `error.message` returned verbatim to clients (info disclosure) | Med | 1 | api routes |
| 13 | Any room member (not just admin) can add agents | Low | 1 | `members/route.ts:39` |
| 14 | Signed-upload trusts client `mime_type`/`size_bytes`; no MIME allowlist | Low | 1 | `signed-upload/route.ts` |
| 15 | Phase9 storage `FOR INSERT` policy may allow upload regardless of room membership | Med? | 1 | `phase9_extensions.sql:54` (verify) |
| 16 | `reply_mode` enum drift: schema `['all','mentioned_only']` rejects canonical `'everyone'` | High | 2 | `api-validation.ts:6` |
| 17 | Adapter registry routes on `adapter_type`; codex/ruflo unreachable; `myclaude` orphan | Med | 2 | `bridge/src/adapters/registry.ts` |
| 18 | `denylist` imported into web test via `../../../../bridge/...`; move to shared | Low | 2 | `denylist.test.ts:2` |
| 19 | Duplicated `ApiResponse<T>`/member types in components vs shared; shared `ApiError` shape disagrees w/ runtime | Low | 2 | shared + components |
| 20 | `next@14.2.35` → 15.x for 6 high advisories (breaking; needs ADR + e2e) | High | 1/2 | `pnpm audit` |
| 21 | TS `strict:true` set but no `noUncheckedIndexedAccess`/`noUnusedLocals`; no shared base tsconfig | Med | 2 | tsconfigs |
| 22 | No Dockerfile/compose/devcontainer; no env-validation-at-boot | — | 5 | standards |
| 23 | `NEXT_PUBLIC_APP_URL` in `.env.example` but unused in code | Info | 2 | env table |

Full reports: `docs/reviews/phase-0-security-seed.md`, `…-deadcode.md`,
`…-standards-and-env.md`, `…-untracked-loadbearing.md`.

### Decisions recorded (will become ADRs where significant)
- **D1 — Capture the uncommitted feature wave in the Phase 0 branch.** It is coherent,
  load-bearing, and green. Committing on a branch (not `main`) via PR respects the
  no-commit-to-main rule. The health-route regression is restored first; the dead
  `api.ts` is deleted; other warts are tracked to their phases.
- **D2 — `gh` absent → push branch + paste-ready PR/issue text** (per `00_MASTER_PROMPT`
  fallback). Recommend installing GitHub CLI to restore automation.
- **D3 — `next@14→15` upgrade is its own change** (breaking; App Router 14→15). Deferred
  to a dedicated Phase 1/2 security PR with an ADR + full e2e re-verify, not bundled
  into P0. P0 security workflow runs `pnpm audit` informationally; the 6 highs are
  risk-accepted-pending-upgrade with this tracked note (DoD allows "risk-accepted in writing").
- **D4 — P0 CI gate = typecheck/lint/test/build (blocking); security.yml = informational**
  until the dep upgrade lands. A minimal ESLint config is added in P0 so `lint` is real.

---

## 2026-05-30 — GOAL: Phase 0 — Baseline, safety net & repo hygiene

- Phase: 0 (Baseline, safety net & repo hygiene)
- Branch/worktree: `harden/p0-baseline-hygiene-ci`
- Iteration budget: 8
- State: ACTIVE (awaiting `/loop`)
- Acceptance criteria (testable):
  - [ ] Stale hygiene removed: 7 `.worktrees/` worktrees removed; 7 local `do/*` branches deleted; `origin/do/0509-6csl` pruned; `git worktree list` shows only the main tree.
  - [ ] `.gitignore` covers `.worktrees/`, `graphify-out/`, `.claude/do-tasks/`, `next-env.d.ts`; nothing generated is tracked; `git status` is clean after the branch's commits.
  - [ ] Coherent feature wave (11 untracked + 11 modified) committed on the branch with: health route restored to `{ ok:true, data:{ service:'agentroom-web' } }`; dead `apps/web/lib/api.ts` deleted (after re-confirming zero live importers). `pnpm typecheck`, `pnpm test`, `pnpm --filter web build` still green.
  - [ ] `.github/workflows/ci.yml`: pnpm (cached) install → typecheck → lint → test → `--filter web build`, on PR + push to `main`; green on the P0 PR.
  - [ ] Minimal ESLint config added so `next lint` runs non-interactively and passes (or reports only tracked, deferred issues).
  - [ ] `.github/workflows/security.yml` (gitleaks + `pnpm audit` + CodeQL JS/TS) + `.github/dependabot.yml` (npm + actions) present and running (audit step informational per D3).
  - [ ] `.editorconfig` + `.nvmrc` (Node 20) added; `launch-agentroom.ps1` repo path derived from `$PSScriptRoot` (no hardcoded machine path).
  - [ ] `PROGRESS.md` baseline recorded (this entry); GitHub tracking issue created — or paste-ready block produced (`GITHUB_ISSUES.md`) since `gh` is absent.
  - [ ] Critique gate: Code-Quality Auditor + Security secret-scan pass with no open Critical/High for the P0 scope (reports in `docs/reviews/`).

Judge rule: DONE only when every box above is checked with linked evidence (CI run,
diff, `git worktree list` output, review reports) and no Critical/High is open.

Next: human runs `/loop` to execute Phase 0 (or `/goal status` / `/goal pause`).
