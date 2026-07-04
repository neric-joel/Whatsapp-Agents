# 0013 — Local-only rewrite: SQLite + filesystem replace Supabase, Docker, and auth

- **Status:** Accepted (enacted in v1.2.0, 2026-06-27)
- **Date:** 2026-07-03 — recorded retroactively; the rewrite itself shipped in
  [v1.2.0](../../CHANGELOG.md) ("Changed — local-only rewrite")
- **Supersedes:** [ADR-0001](0001-locked-stack.md) (the Supabase stack lock) and
  [ADR-0004](0004-local-supabase-default.md) (local Supabase via Docker as the default)

## Context

AgentRoom's identity settled as a **local, single-user desktop tool**: it runs the agent
CLIs you already have installed, on your machine, with your data never leaving it. The
Supabase stack (Postgres, Auth, Realtime, Storage, RLS, the service-role/anon key split)
and its Docker-based local dev served a multi-user hosted deployment the product no
longer targets — and they cost real friction: a login for a single user on their own
machine, Docker + the Supabase CLI as prerequisites, a non-trivial RLS/key security
model, and a cloud-shaped dependency at odds with the local-first pitch.

## Decision

Rewrite the data and auth layers **local-only** (shipped in v1.2.0):

- **`@agentroom/db`** (better-sqlite3): the full schema and the `agent_runs` work queue
  (status machine + atomic claim preserved) ported to SQLite. All state lives under
  `~/.agentroom` (`%APPDATA%\AgentRoom` on Windows): the DB, a `files/` folder for
  uploads, and `config.json` for connected-CLI profiles.
- **Removed:** `@supabase/*`, the `supabase/` folder (migrations/seeds), the
  Dockerfiles + `docker-compose.yml`, the login pages and auth middleware, all RLS
  policies, and their CI jobs (`rls`, docker image builds).
- **Realtime → polling:** the browser polls the read APIs; no realtime service.
- **No accounts:** the web server binds `127.0.0.1` only (enforced since v1.4.0), and
  the API is unauthenticated *because* it is localhost-only. The write-path rule is
  preserved: the browser never writes `agent_runs`/`messages` directly — writes go
  Browser → Next.js route handler → SQLite → bridge.
- **Agent auth stays with each CLI** (Connections model): AgentRoom stores no provider
  keys by default; the optional BYO-credentials keychain (ADR-0010) survives in
  local-only form.

## Consequences

- Clone → `pnpm start` with only Node ≥ 22.13 + pnpm — no Docker, no database install,
  no sign-up. This is the entire onboarding.
- **Single-user by design.** There is no multi-tenant or hosted deployment path any
  more; isolation moved from RLS to the OS (your user account owns `~/.agentroom`),
  the localhost bind, the Origin/CSRF check on every mutating route, and rate limits
  on the expensive routes.
- Queue semantics were preserved, so ADR-0002 (agent_runs as queue) and ADR-0003
  (separate bridge daemon) remain correct in amended, SQLite-flavoured form.
- The docs and every architecture claim had to be re-grounded on the new reality —
  the storage-grounding prompts and the canary gate now teach agents the true local
  storage story (see `docs/CANARY_LOOKAHEAD.md`).

## Alternatives considered

- **Keep self-hosted Supabase as the default** — the prerequisites (Docker, Supabase
  CLI) and the account model are wrong for a single-user local tool.
- **An embedded Postgres** — heavier than better-sqlite3 with no benefit at this scale.
- **Keep auth with local users** — pure friction; there is exactly one user, and the
  server is unreachable off-host.
