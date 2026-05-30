# AgentRoom → Production Hardening Runbook

This folder is a **self-contained operating package** for taking AgentRoom from a
finished MVP to a **self-hostable, open-source-ready, production-grade** project,
driven autonomously by Claude Code (Opus 4.8) with a continuous
**goal → build → self-critique → re-goal** loop.

You are not meant to read these files and do the work by hand. You paste **one
prompt** into Claude Code at the repo root, and the agent reads the rest itself.

---

## What's in here

| File | Role | Who reads it |
|------|------|--------------|
| `00_MASTER_PROMPT.md` | The single prompt you paste into Claude Code to start everything. | **You → Claude** |
| `01_HARDENING_PLAN.md` | The phased workflow (Phase 0–11) with concrete, repo-grounded tasks and acceptance criteria. | Claude (lead) |
| `02_SUBAGENTS.md` | Reusable prompts for the critic / security / UX / quality / QA subagents, plus parallel-orchestration rules (worktrees, multiple terminals, `Task` subagents). | Claude (lead) when spawning agents |
| `03_DEFINITION_OF_DONE.md` | The production-readiness checklist, the GitHub documentation protocol, and the loop's stop conditions. | Claude (every loop iteration) |
| `04_HERMES_CAPABILITIES.md` | Spec for running without Supabase Pro (local Docker) + the Hermes-inspired feature phases 9–11 (agent memory, agent-to-agent interaction, in-product slash commands). | Claude (lead) for phases 9–11 |
| `05_WORKFLOW_COMMANDS.md` | The `/goal`, `/loop`, `/critique`, `/brainstorm`, `/audit`, `/ship`, `/status`, `/memory` commands — what they do and how to install them. | **You + Claude** |
| `claude-commands/*.md` | The actual Claude Code slash-command bodies. Copy into `.claude/commands/` (one-liner in `05`). | Claude Code (as `/commands`) |

---

## How to use it (3 steps)

1. **Open a terminal at the repo root** (`Whatsapp-Agents/`) and start Claude Code with the strongest coding model:

   ```bash
   cd Whatsapp-Agents
   claude --model opus
   ```

2. **Paste the entire contents of `00_MASTER_PROMPT.md`** as your first message. That prompt tells Claude to read the package, install the workflow commands, and run a baseline `/audit` before anything else.

3. **Drive it with two words: `/goal` then `/loop`.** Claude installs the commands (`05_WORKFLOW_COMMANDS.md`), creates a tracking issue + `PROGRESS.md`, then for each phase: you set `/goal` (or let it pick the next phase) and run `/loop`. The loop builds, verifies, runs the adversarial **critic agents** (`02_SUBAGENTS.md`), folds findings in, and opens a PR (`/ship`) — repeating until every box in `03_DEFINITION_OF_DONE.md` is checked. Use `/brainstorm` before the feature phases 9–11. Review and merge the PRs it opens.

---

## The loop (what Claude repeats)

```
        ┌─────────────────────────────────────────────────────────────┐
        │                                                             │
        ▼                                                             │
  SET GOAL  ──▶  PLAN  ──▶  IMPLEMENT  ──▶  VERIFY  ──▶  CRITIQUE      │
 (one phase)   (worktree   (small,        (build/      (spawn red-    │
               + branch)   reviewable     test/lint/   team + spec-   │
                           commits)       e2e green)   ialist agents) │
                                                            │         │
                                                            ▼         │
                                              INTEGRATE feedback ──────┘
                                              then SET NEXT GOAL
                                                            │
                                                            ▼
                                            Definition of Done met?  ──▶  RELEASE v1.0
```

---

## Prerequisites on your machine

- **Claude Code** signed in, with the Opus model available.
- **`gh` (GitHub CLI)** authenticated (`gh auth status`) so Claude can open PRs and issues. If `gh` is unavailable, Claude falls back to plain `git push` + printing PR-ready descriptions for you.
- The existing dev prerequisites from the root `README.md`: Node 20+, pnpm, Docker Desktop, Supabase CLI. **No Supabase Pro/paid plan is needed** — the target is local Supabase via Docker (`pnpm dev:supabase`); see `04_HERMES_CAPABILITIES.md` → Workstream A.
- **Local Claude assets** at `C:\Users\VICTUS\.claude` (agents + skills) and the repo's own `.claude/`. The master prompt instructs Claude to enumerate and reuse these — e.g. the `security-review`, `review`, and code-explorer assets — rather than reinventing them.

---

## Ground rules baked into the package

- **Grounded, not generic.** Every change is justified against real code in this repo. No fabricated APIs, no speculative refactors without evidence.
- **Always green.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm --filter web build` must pass before any PR is opened.
- **Security first.** The bridge executes local CLIs as subprocesses and a Supabase service-role key crosses trust boundaries — these get audited before feature polish.
- **Small, reviewable PRs** on feature branches; conventional commits; progress documented in GitHub.
- **Delete > keep.** Dead code, stale `do/*` worktrees and branches, and generated artifacts are removed or properly ignored, not preserved "just in case."

---

## Where Claude writes its working docs

As it runs, Claude maintains these in the repo (all version-controlled):

- `docs/production-hardening/PROGRESS.md` — living status log, updated every iteration.
- `docs/adr/NNNN-*.md` — Architecture Decision Records for non-trivial choices.
- `docs/reviews/` — saved critic/security/UX review reports per phase.
- `CHANGELOG.md` — user-facing changes, Keep a Changelog format.

Start with `00_MASTER_PROMPT.md`.
