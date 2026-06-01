# 0005 — Subprocess sandbox for agent CLIs

- **Status:** Accepted
- **Date:** 2026-05-30

## Context

The bridge spawns LLM CLIs as child processes with inputs partly derived from
user/agent-controlled data (e.g. an agent's `system_prompt`, the trigger message).
Naïve spawning (a shell string, agent input in argv, the full parent env, no limits)
is a command-injection, secret-exfiltration, and DoS surface. A Phase 1 audit flagged
a Windows shell-spawn + `system_prompt` reaching argv as High.

## Decision

Spawn through a hardened path (`bridge/src/lib/subprocess-security.ts` +
`SubprocessAdapter`):

- `spawn(bin, args[])` with **`shell: false`** — never a shell string, no command
  interpolation of user/agent input.
- The agent `system_prompt` and context packet are delivered via **stdin**, never argv.
- The binary is resolved from an **allowlisted** `*_BIN` path; arbitrary paths are
  rejected.
- The child **environment is minimized** — secrets (`SUPABASE_*`, `*_TOKEN`,
  `*_SECRET`, `BRIDGE_*`) are never forwarded; extra passthrough is opt-in via
  `BRIDGE_CHILD_ENV_ALLOW`.
- **Resource limits:** per-run timeout, a combined stdout/stderr **output cap** (10 MB
  → kill), and `SIGTERM → grace → force-kill the process tree` on
  abort/timeout/cancel. A denylist blocks obviously destructive tool commands.

## Consequences

- The dominant attack surface is contained and unit-tested; cancellation truly kills
  work; a runaway CLI can't OOM or hang the worker.
- Adapters must follow the base-class contract (see CONTRIBUTING) — they can't shell
  out freely.
- This does **not** sandbox what an *allowed* CLI legitimately does on the host; the
  residual risk is covered by the "run only where you trust participants" trust model
  in [SECURITY.md](../SECURITY.md).

## Alternatives considered

- OS-level sandboxing (containers/seccomp per run) — heavier; deferred. The default
  Docker bridge image ships the mock adapter only, which sidesteps it for the safe
  default.
