# 05 — Claude Code Workflow Commands (`/goal`, `/loop`, …)

These are the **Claude Code slash commands you run** to drive the hardening. They are
the Layer-A counterpart to AgentRoom's in-product commands (Phase 11). The command
bodies live in `docs/production-hardening/claude-commands/` so they're
version-controlled and portable; you install them into `.claude/commands/` once.

## Install (one time)

From the repo root:

```bash
# macOS / Linux / WSL
mkdir -p .claude/commands && cp docs/production-hardening/claude-commands/*.md .claude/commands/
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force .claude\commands | Out-Null
Copy-Item docs\production-hardening\claude-commands\*.md .claude\commands\
```

Restart Claude Code (or run `/help`) and the commands appear. Type `/` to autocomplete.

> They're project-scoped (committed with the repo, shared with collaborators). To make
> them personal across all your projects instead, copy them to `~/.claude/commands/`.

## The commands

| Command | What it does |
|---------|--------------|
| `/goal <text>` | Set the standing goal + testable acceptance criteria (judge-gated, Hermes Ralph-loop style). `/goal status\|pause\|resume\|clear`. Defaults to the next open phase. |
| `/loop [once]` | Run plan → implement → verify → `/critique` → integrate → judge, repeatedly, until the goal is DONE or the iteration budget is hit. `once` = single iteration. |
| `/critique [area]` | Spawn the adversarial Critic + specialist reviewers (`security\|ux\|quality\|docs\|qa\|all`) on the current diff; save reports to `docs/reviews/`. |
| `/brainstorm <topic>` | Design a new feature before building (phases 9–11). No code until you approve a design + spec. |
| `/audit` | Phase 0 baseline: secrets, hygiene, dead code, missing standards, current build/test status → seeds `PROGRESS.md`. |
| `/ship [draft]` | Gate checks, commit, push, open a PR with the template. Never touches `main`. |
| `/status` | Progress vs the Definition of Done — active goal, phase map, open Critical/High findings, git state. |
| `/memory load\|save` | Session memory: `load` resumes context at session start (CLAUDE.md + optional Obsidian vault); `save` writes a phase note after a goal is done. |

## The intended flow

```
/memory load                 # resume context (optional; safe to skip first run)
/audit                       # one-time baseline → PROGRESS.md + tracking issue
/goal                        # set the next phase's goal (or /goal "<custom>")
/loop                        # autonomous cycle to DONE, with /critique gate built in
   └─ on DONE → /ship        # PR opened automatically by the loop
/status                      # check progress whenever you want
/brainstorm <feature>        # before phases 9–11 (memory, agent-to-agent, commands)
… repeat /goal → /loop until the Definition of Done is fully checked → v1.0
```

`/loop` calls `/critique` and `/ship` for you; you mostly alternate `/goal` and
`/loop`, review the PRs, and merge. Use `/loop once` when you want to inspect a single
iteration before letting it run free.

## Relationship to the master prompt

`00_MASTER_PROMPT.md` is still the one-time kickoff that orients the agent and points
it at the plan. After you paste it once, you drive the rest with these commands.
If you prefer, you can skip straight to `/audit` → `/goal` → `/loop` once the commands
are installed and the agent has read the package.
