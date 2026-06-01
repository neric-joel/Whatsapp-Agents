# 0003 — A separate bridge daemon runs agent CLIs

- **Status:** Accepted
- **Date:** 2026-05-08

## Context

Agents are local CLIs (Claude Code, Codex, …) that are spawned as child processes,
stream output, can run for minutes, and may need to be killed. Running them inside
Next.js route handlers (serverless/edge, short-lived, no long-lived process control)
is a poor fit and a security risk.

## Decision

Run agent execution in a **separate long-lived Node.js/TypeScript daemon** (`bridge`).
It polls `agent_runs`, builds `ContextPacketV1`, invokes the adapter, streams output,
writes the reply, and manages process lifecycle (timeout, output cap, force-kill).

## Consequences

- Clean separation: the web tier handles HTTP/auth/RLS; the bridge handles untrusted,
  long-running subprocess work. They communicate only through Supabase rows.
- The bridge holds the service-role key and runs CLIs on its host — concentrating the
  sharpest trust boundary in one documented place (see [SECURITY.md](../SECURITY.md)).
- Can scale horizontally (multiple workers; atomic claim prevents double-processing)
  and restart independently (stale-run recovery cleans up orphans).
- One more process to run/deploy (addressed by Docker/compose in
  [ADR-0004](0004-local-supabase-default.md) and `docs/SELF_HOSTING.md`).

## Alternatives considered

- Executing CLIs from route handlers — incompatible with the runtime model and unsafe.
- A serverless function per run — cold starts, no streaming/process control, harder to
  cap and kill.
