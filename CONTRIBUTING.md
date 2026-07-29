# Contributing to AgentRoom

Thanks for your interest in AgentRoom — a group chat where LLM CLIs are visible
participants. This guide covers local setup, the quality gates, and how to land a
change. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node ≥ 22.13** and **pnpm ≥ 11** (the repo pins `pnpm@11.0.8`; `corepack` or
  `npm i -g pnpm@11.0.8`).
- Optional: the agent CLIs you want to exercise (`claude`, `codex`, …). Without them,
  the **mock adapter** works end-to-end. No Docker, no database, no accounts — state is
  local SQLite under `~/.agentroom`.

See the [Quickstart in the README](README.md#quickstart-a-couple-of-minutes-to-a-working-app)
for the fast path. End users run `pnpm start` (the built app); contributors use `pnpm dev`
(watch mode) below.

## Local setup

```bash
pnpm install
pnpm dev                 # web (:3000) + bridge in parallel, watch mode
```

The first run creates `~/.agentroom/` (`%APPDATA%\AgentRoom` on Windows — SQLite DB +
a `files/` folder) and seeds a starter room — no env files needed for local use (the
`.env.example` files document optional vars).

Env vars are documented in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#environment-variables).
**Nothing is required for local use** — every var is an optional override, validated at
boot (zod) with an error that names the offending var if one is set but invalid.

## Quality gates (run before every PR)

CI runs these on every PR; run them locally first:

```bash
pnpm typecheck      # tsc across all workspaces (strict + noUncheckedIndexedAccess)
pnpm lint           # ESLint flat config — must be 0 errors
pnpm format:check   # Prettier
pnpm exec knip      # dead-code / unused-deps — must be 0 findings
pnpm test           # web (vitest) + bridge (node:test) + db (node:test)
pnpm --filter web build
```

For end-to-end / data-layer work:

```bash
pnpm e2e            # Playwright (mock adapter; live journeys gated on E2E_LIVE)
# DB tests run via the workspace `test` script (packages/db/test/, node:test)
```

A change is not ready until typecheck, lint (0 errors), format, knip, and tests are
green locally **and** every CI check is green on the PR. Nothing on the GitHub side
forces that second half: this repository has **no required status checks**, so a red
check does not block the merge button — keeping a PR green is a contributor obligation,
not a mechanism. (Security checks _do_ gate a **release** — see
[Hardening status](SECURITY.md#hardening-status) for exactly which ones and where.) The
`audit` job (`pnpm audit --audit-level high`) **fails its run** on a high advisory — it
carried `continue-on-error` under decision D3 of
[ADR-0009](docs/adr/0009-v1.0.1-deferred-gates.md) while a dev-toolchain advisory was
outstanding (issue #78); that was resolved, so the allowance was retired.
If a new high advisory lands in a transitive dependency, bump the direct dependency that
pulls it, or add a targeted override in `pnpm-workspace.yaml` (pnpm 11 does not read
overrides from `package.json`).

## Branching, commits, and PRs

- **Trunk-based.** `main` is the single source of truth (always releasable). Cut a
  **short-lived** feature branch off `main`, open a PR, merge it back, then **delete the
  branch**. Don't let long-running or stacked branches accumulate.
- **Never push to `main`.** It is protected. Work on a branch and open a PR.
- Branch naming: `feat/…`, `fix/…`, `chore/…`, or `docs/…`.
- **[Conventional Commits](https://www.conventionalcommits.org/):** `feat(p6): …`,
  `fix(security): …`, `docs: …`, `test: …`, `chore: …`.
- Keep a PR to **one concern**. Fill in the PR template (what/why, changes, risk &
  rollback, verification evidence; screenshots for UI). Link the issue with
  `Closes #N`.
- Don't weaken the Origin/CSRF check, the per-room role check, subprocess validation,
  the canary fail-safe, memory injection scanning, or secret/PII redaction to make a
  check pass. (The tool-approval flow is dormant scaffolding — no bundled adapter
  emits `tool_call_requested`, see #83 — but don't weaken it either.)

## Testing expectations

- New logic in a risk area (mention parsing, loop guards, discussion orchestration,
  adapter prompt construction, run state machine, API validation/authz) ships with
  tests that assert **behavior**, not implementation.
- Tests must be **deterministic** — use the mock adapter; no real network/LLM calls in
  the default suite. Coverage floors are enforced in CI.

## Architecture & conventions

- Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first. The hard rule: the browser
  never writes `agent_runs`/`messages` directly — writes go Browser → Next.js route
  handler → local SQLite (`@agentroom/db`) → bridge.
- `web` and `bridge` share code only through `packages/shared` (types + helpers) and
  the DB contract — no cross-layer imports.
- Significant decisions are recorded as ADRs in [`docs/adr/`](docs/adr/). Add one when
  you make a decision worth remembering.

## Adding a new agent adapter (extensibility)

Adapters live in `bridge/src/adapters/`. A subprocess adapter extends
`SubprocessAdapter` and implements `resolveCommand()`, `buildArgs()`, and
`envVarName()`; it yields the `AgentEvent` union and must **never** write to the
database directly (the run worker owns persistence). Register it in
`bridge/src/adapters/registry.ts` **and** add its `adapter_type` to
`AGENT_ADAPTER_TYPES` in `apps/web/lib/api-validation.ts` (the agents API rejects
unknown types). Most bring-your-own CLIs need **no** new adapter at all — the `cli`
profile adapter covers any binary that reads a prompt on stdin. Respect the
subprocess trust model in
[`SECURITY.md`](SECURITY.md): no shell strings, no agent input in argv, allowlisted
binary, minimized env.

## Reporting bugs / requesting features

Use the GitHub issue templates. For **security** issues, do **not** open a public
issue — follow [`SECURITY.md`](SECURITY.md).
