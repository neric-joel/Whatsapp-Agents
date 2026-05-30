---
description: Run the autonomous goal-build-verify-critique-re-goal cycle to completion
argument-hint: [once]
allowed-tools: Read, Write, Edit, Bash, Task, Grep, Glob, WebSearch, WebFetch
---

# /loop — run the hardening loop

Drive the active goal (set via `/goal`) to completion using the cycle below. If no
goal is active, stop and tell me to run `/goal` first. Argument `$ARGUMENTS`: if it
is `once`, run a single iteration and stop for review; otherwise continue until the
judge returns DONE, the goal is paused/cleared, or the iteration budget is hit.

Read first (treat as binding): `docs/production-hardening/01_HARDENING_PLAN.md`,
`04_HERMES_CAPABILITIES.md` (for phases 9–11), `02_SUBAGENTS.md`,
`03_DEFINITION_OF_DONE.md`.

## One iteration

1. **PLAN** — list the concrete changes, the files you expect to touch, the branch/
   worktree, and the verification you'll run. Keep it tight.
2. **IMPLEMENT** — small, conventional commits. Reuse local `~/.claude` and repo
   `.claude` assets; cite any web sources you relied on.
3. **VERIFY** — run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
   `pnpm --filter web build`, plus phase-specific checks (e2e / `axe` / `gitleaks` /
   `pnpm audit`). Capture real output as evidence. If red, fix before continuing.
4. **CRITIQUE** — run `/critique` for this phase (spawns the adversarial Critic plus
   the relevant specialist agents from `02_SUBAGENTS.md`). Save reports to
   `docs/reviews/`.
5. **INTEGRATE** — triage findings by severity. Fix every Critical/High before the
   goal can be DONE. Defer Medium/Low only as tracked GitHub issues with a reason.
6. **JUDGE** — evaluate the goal's acceptance criteria honestly against evidence.
   - **DONE** → run `/ship` to open the PR, update PROGRESS.md + the DoD boxes, then
     propose the next `/goal` (next open phase). Stop and report.
   - **CONTINUE** → write a one-line judge note in PROGRESS.md (what's missing) and
     start the next iteration.

## Guardrails (do not violate)

- Never push to `main`; work on a branch and open a PR via `/ship`.
- Never weaken auth, RLS, the tool-approval flow, subprocess validation, or memory
  injection scanning to make a check pass.
- Never fabricate evidence or mark a criterion done with failing checks.
- If a choice is irreversible/expensive and genuinely ambiguous, pause and ask me ONE
  precise question; otherwise pick the justified default, record it, and proceed.
- Respect `/goal pause`. Stop when the iteration budget is reached and report status.
