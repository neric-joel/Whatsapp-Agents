# Paste-ready GitHub issues (`gh` not installed)

`gh` is not on this machine, so issues/PRs can't be auto-created. Either install it
(`winget install GitHub.cli`, then `gh auth login`) and tell me to re-run the create
step, or paste the blocks below at
https://github.com/neric-joel/Whatsapp-Agents/issues/new.

Suggested labels to create once: `phase:0`…`phase:11`,
`area:security|quality|testing|ux|dx|ops|docs|release`,
`severity:critical|high|medium|low`.

---

## Issue: Production hardening — meta tracker (MVP → v1.0)

Labels: `area:ops`

Umbrella issue tracking the production-hardening effort defined in
`docs/production-hardening/`. Phases 0–11 → tagged `v1.0.0`. Living status in
`docs/production-hardening/PROGRESS.md`; Definition of Done in `03_DEFINITION_OF_DONE.md`.

- [ ] Phase 0 — Baseline, safety net & repo hygiene (#TBD)
- [ ] Phase 1 — Security hardening
- [ ] Phase 2 — Code quality, type-safety & dead-code removal
- [ ] Phase 3 — Automated testing & verification
- [ ] Phase 4 — UI/UX excellence & accessibility
- [ ] Phase 5 — DX, containerization & onboarding (local-Docker Supabase, no Pro)
- [ ] Phase 6 — Observability, reliability & error handling
- [ ] Phase 7 — Documentation & OSS readiness
- [ ] Phase 8 — Release engineering & v1.0
- [ ] Phase 9 — In-product agent memory (Hermes-style, Postgres FTS)
- [ ] Phase 10 — First-class agent-to-agent interaction
- [ ] Phase 11 — In-product slash-command registry + RBAC

---

## Issue: Phase 0 — Baseline, safety net & repo hygiene

Labels: `phase:0`, `area:ops`

**Goal:** know exactly what's here, stop the bleeding, make the repo safe to work in,
and gate every later PR with CI. Full audit: `docs/production-hardening/PROGRESS.md`
(2026-05-30 entry) + `docs/reviews/phase-0-*.md`.

**Baseline (2026-05-30):** typecheck ✅ / build ✅ / test ✅ (14) / lint ⚠ unconfigured /
`pnpm audit` ⚠ 18 vulns (6 high, mostly `next@14`). Secrets: clean. Docker daemon down
(blocks local-Supabase smoke). `gh` absent.

**Acceptance criteria**
- [ ] Stale 7 `.worktrees/` worktrees + 7 `do/*` branches + `origin/do/0509-6csl` removed; `git worktree list` shows only main.
- [ ] `.gitignore` covers `.worktrees/`, `graphify-out/`, `.claude/do-tasks/`, `next-env.d.ts`; clean `git status`.
- [ ] Coherent feature wave committed; health route restored to `{ok:true,data:{service}}`; dead `lib/api.ts` deleted; typecheck/test/build green.
- [ ] `.github/workflows/ci.yml` (typecheck→lint→test→build) green on the PR; minimal ESLint config added.
- [ ] `.github/workflows/security.yml` (gitleaks + pnpm audit + CodeQL) + `dependabot.yml` present.
- [ ] `.editorconfig` + `.nvmrc` (Node 20); `launch-agentroom.ps1` path de-hardcoded.
- [ ] Critique gate (Code-Quality + Security secret-scan) = no open Critical/High for P0 scope.

Closed by the `harden/p0-baseline-hygiene-ci` PR.

---

## Issue: Phase 1 — security backlog seeded by the audit (create with Phase 1)

Labels: `phase:1`, `area:security`

Seeded findings (see `docs/reviews/phase-0-security-seed.md`), to split into sub-issues:
- [ ] **High** — subprocess `shell:true` on win32 + `system_prompt` arg → command injection (`subprocess-adapter.ts:27`)
- [ ] **High** — no child output-size cap (memory DoS)
- [ ] **High** — full `process.env` forwarded to child → service-role key leak
- [ ] **Med** — `*_BIN` not allowlisted; child `cwd` not validated
- [ ] **Med** — denylist bypassable + guards stubbed exec
- [ ] **Med** — Supabase `error.message` leaked to clients
- [ ] **Med?** — phase9 storage `FOR INSERT` policy membership check (verify)
- [ ] **Low** — member (not admin) can add agents; signed-upload MIME/size not enforced
- [ ] **High** — `next@14→15` upgrade for 6 high advisories (ADR + e2e)
