# 0001 — Locked stack: Next.js + Supabase + bridge daemon + pnpm monorepo

- **Status:** Accepted
- **Date:** 2026-05-08

## Context

AgentRoom needs a chat UI with realtime updates, auth, file storage, a relational
data model, and a way to run local LLM CLIs. We wanted a small, batteries-included
stack a solo developer can run locally and self-host without a managed platform.

## Decision

Lock the stack: **Next.js App Router** (frontend + route handlers) · **Supabase**
(Postgres, Auth, Realtime, Storage) · a **separate Node.js/TypeScript bridge daemon**
for agent execution · **pnpm workspaces** monorepo (`apps/web`, `bridge`,
`packages/shared`, `supabase`).

## Consequences

- Realtime, auth, storage, and RLS come from one system (Supabase), reducing glue.
- Shared types live in `packages/shared`; web and bridge never import each other's
  internals — they share only types + the DB contract.
- TypeScript end-to-end; one package manager; one lockfile.
- Coupling to Supabase's APIs and RLS model (accepted — self-hostable via Docker).

## Alternatives considered

- Custom Express/Fastify backend + self-managed Postgres/Redis/websockets — more
  moving parts, more ops.
- Running agents inside the web process — rejected; see [ADR-0003](0003-separate-bridge-daemon.md).
