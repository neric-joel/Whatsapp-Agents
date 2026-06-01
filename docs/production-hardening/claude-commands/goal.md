---
description: Set or control the standing hardening goal (judge-gated Ralph loop)
argument-hint: <goal text> | status | pause | resume | clear
allowed-tools: Read, Write, Edit, Bash(git:*)
---

# /goal — set the standing goal

Inspired by Hermes Agent's `/goal`: you set a standing objective; after each loop
iteration a judge step decides DONE vs CONTINUE, and `/loop` keeps working until the
goal is met, you pause/clear it, or the iteration budget is hit.

Argument: `$ARGUMENTS`

## Behavior

- **`status`** → report the active goal, its acceptance criteria, the iterations
  spent, and the latest judge verdict. Read it from
  `docs/production-hardening/PROGRESS.md`.
- **`pause` / `resume`** → set the goal state; `/loop` must honor it.
- **`clear`** → close out the active goal (note why in PROGRESS.md).
- **anything else** → treat `$ARGUMENTS` as the new goal statement.

## When setting a new goal

1. If no goal text was given, default to the **next open phase** in
   `docs/production-hardening/01_HARDENING_PLAN.md` (and `04_HERMES_CAPABILITIES.md`
   for phases 9–11). State which phase and why.
2. Write a goal block to `docs/production-hardening/PROGRESS.md`:
   ```
   ## <date> — GOAL: <one-line goal>
   - Phase: <n> (<name>)
   - Acceptance criteria (testable):
     - [ ] <criterion 1>
     - [ ] <criterion 2>
   - Branch/worktree: harden/<phase>-<slug>
   - Iteration budget: <default 8> (raise only with reason)
   - State: ACTIVE
   ```
3. Acceptance criteria MUST be objective and verifiable (a command, a test, a saved
   review, a screenshot) — never "looks good". Pull them from the plan + the
   Definition of Done (`03_DEFINITION_OF_DONE.md`).
4. Do NOT start building. Print the goal block and tell me to run `/loop` (or
   `/brainstorm <topic>` first if the work is a new feature that needs a design).

The judge rule the loop will use: a goal is DONE only when every acceptance criterion
is checked **with linked evidence** and no Critical/High review finding is open.

PROJECT completion is separate and stricter than a goal being DONE: the whole effort
is finished — and `docs/production-hardening/DONE.flag` may be created — ONLY when every
box in `03_DEFINITION_OF_DONE.md` is checked AND `v1.0` is tagged. A finished goal or
phase is never, by itself, project completion.
