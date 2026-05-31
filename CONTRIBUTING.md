# Contributing to AgentRoom

Thanks for your interest in AgentRoom — a group chat where LLM CLIs are visible
participants. This guide covers local setup, the quality gates, and how to land a
change. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node ≥ 22.13** and **pnpm ≥ 11** (the repo pins `pnpm@11.0.8`; `corepack` or
  `npm i -g pnpm@11.0.8`).
- **Docker** + the **Supabase CLI** for the local database (`supabase start`).
- Optional: the agent CLIs you want to exercise (`claude`, `codex`, …). Without them,
  the **mock adapter** works end-to-end.

See [`QUICKSTART.md`](QUICKSTART.md) for the fast path and
[`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for the full setup, including the
Docker/devcontainer paths.

## Local setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in values
cp bridge/.env.example bridge/.env             # fill in values
pnpm dev:supabase        # start local Supabase (Docker)
pnpm db:reset            # apply migrations + seed
pnpm dev                 # web (:3000) + bridge in parallel
```

Env vars are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#environment-variables)
and validated at boot (zod) — a missing/invalid var fails fast and names itself.

## Quality gates (run before every PR)

CI runs these on every PR; run them locally first:

```bash
pnpm typecheck      # tsc across all workspaces (strict + noUncheckedIndexedAccess)
pnpm lint           # ESLint flat config — must be 0 errors
pnpm format:check   # Prettier
pnpm knip           # dead-code / unused-deps — must be 0 findings
pnpm test           # web (vitest) + bridge (node:test)
pnpm --filter web build
```

For end-to-end / DB-policy work:

```bash
pnpm e2e            # Playwright (mock adapter; live journeys gated on E2E_LIVE)
# RLS policy tests run via pgTAP against a local Supabase (see supabase/tests/)
```

A change is not ready until typecheck, lint (0 errors), format, knip, and tests are
green locally **and** the GitHub CI required checks are green on the PR. The `audit`
job is informational (a known transitive advisory tracked for the next@15 upgrade).

## Branching, commits, and PRs

- **Never push to `main`.** It is protected. Work on a branch and open a PR.
- Branch naming: `feat/…`, `fix/…`, or `harden/…` for hardening-effort work.
- **[Conventional Commits](https://www.conventionalcommits.org/):** `feat(p6): …`,
  `fix(security): …`, `docs: …`, `test: …`, `chore: …`.
- Keep a PR to **one concern**. Fill in the PR template (what/why, changes, risk &
  rollback, verification evidence; screenshots for UI). Link the issue with
  `Closes #N`.
- Don't weaken auth, RLS, the tool-approval flow, subprocess validation, or
  secret/PII redaction to make a check pass.

## Testing expectations

- New logic in a risk area (mention parsing, loop guards, discussion orchestration,
  adapter prompt construction, run state machine, API validation/authz) ships with
  tests that assert **behavior**, not implementation.
- Tests must be **deterministic** — use the mock adapter; no real network/LLM calls in
  the default suite. Coverage floors are enforced in CI.

## Architecture & conventions

- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first. The hard rule: the browser
  never writes `agent_runs`/`messages` directly — writes go Browser → Next.js route
  handler → Supabase rows → bridge.
- `web` and `bridge` share code only through `packages/shared` (types + helpers) and
  the DB contract — no cross-layer imports.
- Significant decisions are recorded as ADRs in [`docs/adr/`](docs/adr/). Add one when
  you make a decision worth remembering.

## Adding a new agent adapter (extensibility)

Adapters live in `bridge/src/adapters/`. A subprocess adapter extends
`SubprocessAdapter` and implements `resolveCommand()`, `buildArgs()`, and
`envVarName()`; it yields the `AgentEvent` union and must **never** write to Supabase
directly (the run worker owns persistence). Register it in
`bridge/src/adapters/registry.ts`. Respect the subprocess trust model in
[`SECURITY.md`](SECURITY.md): no shell strings, no agent input in argv, allowlisted
binary, minimized env.

## Reporting bugs / requesting features

Use the GitHub issue templates. For **security** issues, do **not** open a public
issue — follow [`SECURITY.md`](SECURITY.md).
