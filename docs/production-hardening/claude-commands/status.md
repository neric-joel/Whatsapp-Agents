---
description: Show progress against the Definition of Done
allowed-tools: Read, Bash(git:*), Grep
---

# /status — where are we

Give me a tight status read, computed from the repo (no fluff):

1. **Active goal** — from `docs/production-hardening/PROGRESS.md`: the goal,
   acceptance criteria checked vs total, iterations spent, last judge verdict.
2. **Phase map** — for phases 0–11 (`01_HARDENING_PLAN.md` + `04_HERMES_CAPABILITIES.md`):
   done / in-progress / pending.
3. **DoD** — count of checked vs total boxes per section in
   `03_DEFINITION_OF_DONE.md`.
4. **Open findings** — Critical/High from `docs/reviews/` not yet resolved, and any
   deferred items tracked as GitHub issues.
5. **Git** — `!git branch --show-current`, `!git log --oneline -5`, open PRs
   (`!gh pr list` if available).

End with the single most important next action (usually a `/goal` or `/loop`).
