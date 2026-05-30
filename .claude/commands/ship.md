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
6. Report the PR URL (or the paste-ready block) and the next suggested `/goal`.

A PR is not "done" until checks are green and a Critical/High-free critique is
attached.
