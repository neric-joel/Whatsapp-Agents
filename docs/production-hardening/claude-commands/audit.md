---
description: Run the Phase 0 baseline audit (inventory, secrets, dead code, hygiene)
allowed-tools: Read, Bash, Grep, Glob
---

# /audit — baseline audit

Produce the authoritative starting inventory before any work. Do not change code;
this is read-only reconnaissance that seeds `PROGRESS.md`.

## Checks

1. **Secrets:** `!git ls-files | grep -iE '\.env$|\.env\.|secret|key|credential'` and
   confirm `bridge/.env`, `apps/web/.env.local` are NOT tracked. Scan history with
   `gitleaks` if available. Any committed secret = SEV-1 → flag + instruct rotation.
2. **Repo hygiene:** list `.worktrees/` worktrees (`!git worktree list`) and stale
   `do/*` branches (`!git branch -a`); confirm `graphify-out/`, `.launch-web.log`,
   `.claude/do-tasks/` are gitignored (and untrack any generated files that are
   tracked).
3. **Dead/uncertain code:** run `knip`/`ts-prune`/`depcheck` if available, else map
   unused exports/files. Classify each: keep (justify) / abstract / delete — checking
   git history + call sites first.
4. **Missing standards:** check for CI (`.github/workflows`), `Dockerfile`,
   `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, root eslint/prettier, `.nvmrc`.
5. **Current status:** run `pnpm typecheck`, `pnpm lint`, `pnpm test`,
   `pnpm --filter web build` and record pass/fail + counts.
6. **Supabase:** confirm local Supabase via Docker works (`pnpm dev:supabase`) — the
   target is local-Docker-first, no Pro plan (see `04_HERMES_CAPABILITIES.md`).

## Output

Write the findings to `docs/production-hardening/PROGRESS.md` under a Phase 0 heading,
mapped to the backlog table in `01_HARDENING_PLAN.md`, then propose the Phase 0
`/goal`. Open the GitHub tracking issue (`gh issue create`) if `gh` is available.
