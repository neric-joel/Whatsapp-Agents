# 0004 — Local Supabase via Docker is the default (no paid plan)

- **Status:** Accepted
- **Date:** 2026-05-30

## Context

AgentRoom should be self-hostable by anyone in minutes with no paid services. Hosted
Supabase free-tier projects pause on inactivity and tie a contributor to an account,
which is friction for a clone-and-run open-source project.

## Decision

Make **local Supabase via the Supabase CLI + Docker** (`pnpm dev:supabase`) the
documented default for development and solo use, and provide a self-hosted production
path via `docker-compose.yml` using the same migrations + seed. A hosted free-tier is
demoted to an optional appendix in `docs/SELF_HOSTING.md` (with its pause caveat). No
paid plan is required anywhere.

## Consequences

- Clone → running in minutes with only Docker + Node + pnpm.
- The browser-vs-container Supabase URL split (`NEXT_PUBLIC_SUPABASE_URL` vs
  `SERVER_SUPABASE_URL`) must be documented — done in compose + SELF_HOSTING.
- Contributors test against a real Postgres with the actual RLS policies locally.

## Alternatives considered

- Hosted Supabase as the default — pausing + account coupling hurt the OSS story.
- SQLite/in-memory for dev — diverges from production RLS/Realtime semantics.
