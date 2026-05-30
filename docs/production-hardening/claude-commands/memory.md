---
description: Sync Claude Code session memory (CLAUDE.md + optional Obsidian vault)
argument-hint: load | save
allowed-tools: Read, Write, Edit, Bash
---

# /memory — session memory (so sessions don't restart cold)

Wire the session-memory layers the project already designed (see the Obsidian memory
setup doc) so a new Claude Code session resumes with full context instead of
re-reading source. This is the WORKFLOW memory (for you, the builder) — distinct from
the in-product agent memory built in Phase 9. Argument `$ARGUMENTS`: `load` or `save`.

## load  (run at session start)

1. Read `CLAUDE.md` (repo root) — phase tracker, env vars, architecture, rules.
2. Read `docs/production-hardening/PROGRESS.md` — active goal + last judge verdict.
3. If an Obsidian Local REST API is configured (`OBSIDIAN_KEY`, host
   `http://127.0.0.1:27123`), read `AgentRoom/_PROJECT.md` and the latest phase note
   via curl. If not configured, skip silently — Obsidian is optional.
4. Print a 5-line briefing: current phase, active goal, what shipped last, what's next.

## save  (run after a goal is judged DONE)

1. Update the phase tracker + acceptance results in `CLAUDE.md`; commit it
   (`chore: update CLAUDE.md — phase N`).
2. Append the iteration outcome to `PROGRESS.md`.
3. If Obsidian is configured, PUT a phase-completion note to
   `AgentRoom/phases/phase-N-<name>.md` and update `AgentRoom/_PROJECT.md` (use the
   template in the project's Obsidian memory setup doc).

Never write secrets into memory notes. Redact env values.
