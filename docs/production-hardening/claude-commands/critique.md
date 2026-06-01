---
description: Spawn the adversarial + specialist review panel on the current diff
argument-hint: [security|ux|quality|docs|qa|all]
allowed-tools: Read, Bash(git:*), Task, Grep, Glob, WebSearch, WebFetch
---

# /critique — adversarial review gate

Run the critique gate defined in `docs/production-hardening/02_SUBAGENTS.md` against
the work in progress. Argument `$ARGUMENTS` selects which reviewers (default: the
Adversarial Critic plus the specialists relevant to the active phase; `all` runs
every reviewer).

## Steps

1. Establish scope: `!git diff --stat main...HEAD` and `!git diff main...HEAD`
   (read the actual diff — do not trust summaries).
2. Always include the **Adversarial Critic / Red-Team**. Add specialists by argument
   or phase:
   - security → **Security Auditor**
   - ux → **UI/UX & Accessibility Reviewer**
   - quality → **Code-Quality & Dead-Code Auditor**
   - docs → **DX & Docs Reviewer**
   - qa → **QA / Verification agent**
3. Before writing a reviewer prompt, check `~/.claude` and repo `.claude` for a
   matching asset (e.g. a `security-review` skill or `review` command) and prefer it.
4. Spawn the selected reviewers **in parallel** (multiple `Task` calls in one turn),
   each using its prompt + the universal output contract from `02_SUBAGENTS.md`.
5. Save each report to `docs/reviews/<phase>-<reviewer>.md` and print a consolidated
   triage table: SEV | title | where | recommended fix | accept/defer.

You (the lead) verify each finding before acting — do not merge a reviewer's claim
unverified. Critical/High must be fixed before the active goal can be judged DONE.
