# 0012 — Remove the unused `ruflo` and `myclaude` adapters

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

The adapter set declared `mock`, `claude-code`/`subprocess` (Claude), `codex-cli` (Codex),
`myclaude`, and `ruflo`. An audit for production-readiness found that **`ruflo` and `myclaude`
were never actually run**:

- **No seed agent** uses them — the seed defines only `claude_thinker` (subprocess/Claude),
  `codex_builder` (codex-cli), and `reviewer` (mock).
- **No tests** reference either adapter.
- **No bin is expected** in practice — `RUFLO_BIN`/`MYCLAUDE_BIN` were declared in
  `bridge/.env.example` but never set anywhere real.
- `ruflo` was spread across ~15 files and `myclaude` across ~11, including the registry, the
  `AGENT_PROVIDERS`/`AGENT_ADAPTER_TYPES` enums, the shared `AgentProvider` type,
  `provider-styles`, the subprocess env allowlist (`RUFLO_`), Docker/compose, the Windows
  launcher, and four docs.
- `ruflo`'s original role was a "build orchestrator," documented only in the now-removed
  internal `CLAUDE.md` — context a public cloner never had.

`knip` did **not** flag them (they were imported by `registry.ts`, so static analysis sees them
as "used"); the real signal is *no seed + no test = never exercised*. Each was also an
unframed-subprocess surface (a declared way to shell out to an unspecified `*_BIN`) carrying
risk for zero delivered value.

## Decision

**Remove both `ruflo` and `myclaude` entirely.** The project ships exactly the adapters it
runs: **`claude-code`/`subprocess` (Claude Code), `codex-cli` (Codex), and `mock`.** The BYO
credential providers `openai` + `custom` are retained (they back Settings → Providers, not an
adapter).

Removed: `bridge/src/adapters/{ruflo,myclaude}-adapter.ts`, their `registry.ts` cases + imports,
`AGENT_ADAPTER_TYPES`/`AGENT_PROVIDERS` entries, the shared `AgentProvider` `'ruflo'` member,
`provider-styles` `ruflo` entry, the `RUFLO_` token in the subprocess env allowlist,
`RUFLO_BIN`/`MYCLAUDE_BIN` in `bridge/.env.example` + `start-agentroom.bat`, and the Docker/
compose/`SECURITY`/`ARCHITECTURE`/`SELF_HOSTING`/`README` references.

## Consequences

- **Positive.** Smaller, honest adapter surface; one less unframed-subprocess path; docs match
  reality; enums/registry/types are now exactly what runs.
- **Reversible.** Both adapters remain in git history; re-introducing one means restoring the
  adapter file + its registry case + enum entries + a seed/test, which is the bar any *used*
  adapter should meet.
- **No behavior change** for real users — nothing ran through either adapter.
