---
description: Finalize the current branch and open a reviewable PR
argument-hint: [draft]
allowed-tools: Read, Bash, Edit
---

# /ship — open the PR

Finalize the current workstream into a small, reviewable Pull Request. Never push to
`main`. Argument `$ARGUMENTS`: `draft` opens a draft PR.

## Steps

1. **Gate:** confirm `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
   `pnpm --filter web build` pass. If red, stop — do not ship.
2. **Hygiene:** `!git status` and `!git diff --stat main...HEAD`. Ensure no secrets,
   no stray generated files, and only one concern in this branch.
3. **Commit** any remaining changes with a Conventional Commit message.
4. **Docs:** update `docs/production-hardening/PROGRESS.md` and, if user-facing,
   `CHANGELOG.md` in this same branch. Link the saved review(s) in `docs/reviews/`.
5. **PR:** push and `gh pr create` using the template in
   `03_DEFINITION_OF_DONE.md` (what & why, changes, risk & rollback, verification
   evidence, screenshots for UI, `Closes #<issue>`). If `gh` is unavailable, push the
   branch and print a ready-to-paste PR title + body and tell me what to do.
6. **CI (required — local green is necessary but NOT sufficient):** after the PR is
   opened or updated, confirm GitHub CI with `gh pr checks <n>` (e.g.
   `gh pr checks <n> --watch`). The `audit` job is informational (allowed-red per
   decision D3); ANY other red/failing required check is a failure — self-heal
   (fix → re-verify locally → push) until those checks pass before the goal is DONE.
7. Report the PR URL (or the paste-ready block), the CI check status, and the next
   suggested `/goal`.

A PR is not "done" until its **GitHub CI required checks are green** (`gh pr checks
<n>`; the `audit` job may stay red per decision D3) and a Critical/High-free critique
is attached. Local green alone is necessary but not sufficient.
