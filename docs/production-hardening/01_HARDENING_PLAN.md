# 01 — Production Hardening Plan (Phases 0–8)

Target state: **self-hostable, open-source-ready, production-grade**. Workflow:
feature branches + PRs. This plan is **living** — amend it (in a `docs:` commit,
with a reason) if reality contradicts it.

**Conventions used below**
- *Branch* — suggested branch name. *Verify* — the proof required before the PR.
- *Critique gate* — the subagent(s) from `02_SUBAGENTS.md` that must review before
  the phase closes. No phase closes with an open High/Critical finding.
- Each phase ends by updating `PROGRESS.md` and the relevant boxes in
  `03_DEFINITION_OF_DONE.md`.

Suggested ordering: 0 → 1 → 2 → 3 run mostly in sequence (they build the safety
net). 4, 5, 6 can run in **parallel worktrees** once the net exists. 7 and 8 close
out. Don't skip the gates to go faster. Capability phases **9–11** (memory,
agent-to-agent, in-product commands — see `04_HERMES_CAPABILITIES.md`) layer on
**after** 0–3 and are folded into the v1.0 Definition of Done.

---

## Phase 0 — Baseline, safety net & repo hygiene

**Goal:** know exactly what's here, stop the bleeding, and make the repo safe to
work in fast.

**Tasks**
- Produce the authoritative inventory:
  - `git ls-files` scan for any tracked secret/env/key/credential file. Confirm
    `bridge/.env` and `apps/web/.env.local` are NOT tracked. If any secret was ever
    committed, flag SEV-1 and instruct rotation.
  - Map dead/uncertain code: unused exports, unreferenced files, commented-out
    blocks, `scripts/` no longer used. For each, decide keep (justify) / abstract /
    delete. Do not delete on a hunch — check git history + usages first.
  - List stale `do/*` branches and `.worktrees/` worktrees. Remove the worktrees
    (`git worktree remove`), delete merged/obsolete local branches, and prune the
    remote tracking branch if dead.
- Repo hygiene:
  - Extend `.gitignore` to cover `.worktrees/`, `graphify-out/`, `.launch-web.log`,
    `.claude/do-tasks/`, and any other generated output found. Untrack anything
    generated that's currently tracked (`git rm --cached`).
  - Add `.editorconfig`, `.nvmrc`/`.node-version` (Node 20), and confirm
    `pnpm-workspace.yaml` is correct.
- Bootstrap CI so every later PR is gated (minimal but real):
  - `.github/workflows/ci.yml`: install (pnpm, cached) → `typecheck` → `lint` →
    `test` → `pnpm --filter web build`, on PR + push to main.
  - `.github/workflows/security.yml`: secret scan (`gitleaks`), `pnpm audit`
    (or `osv-scanner`), and enable CodeQL for JS/TS.
  - Add Dependabot (`.github/dependabot.yml`) for npm + GitHub Actions.
- Record current baseline: does `typecheck`/`lint`/`test`/`build` pass today? Capture
  the numbers (test count, any failures) in PROGRESS.md.

**Verify:** CI is green on the Phase 0 PR; `git status` clean; no tracked generated
files; worktrees/branches pruned; inventory written to PROGRESS.md.
**Branch:** `harden/p0-baseline-hygiene-ci`
**Critique gate:** Code-Quality Auditor + a quick Security pass for the secret scan.

---

## Phase 1 — Security hardening (highest priority)

**Goal:** the app is safe to run with real credentials and safe to expose. This is
the most important phase for this project.

**Tasks**
- **Subprocess execution (the crown jewel).** Audit `bridge/src/adapters/*` and
  `subprocess-adapter.ts`:
  - Never spawn via a shell string; use `spawn(bin, args[])` with `shell:false`.
    Eliminate any string interpolation of user/agent input into commands.
  - Allowlist the agent binaries (CLAUDE_BIN, CODEX_BIN, MYCLAUDE_BIN, RUFLO_BIN);
    reject arbitrary paths. Validate/normalize the working directory.
  - Enforce timeouts, max output size, and concurrency caps (env already exposes
    `BRIDGE_STALE_RUN_TIMEOUT_MS`, `BRIDGE_MAX_CONCURRENT_RUNS` — confirm they're
    enforced, not just declared). Kill + clean up orphaned child processes.
  - Sanitize/limit the environment passed to children; don't forward the full env.
- **Secret + key boundary.** Prove `SUPABASE_SERVICE_ROLE_KEY` is server-only — it
  must never be imported into a client component or appear in the web bundle. Audit
  every use of the service-role client vs. the anon/publishable client. Confirm the
  README's note (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, not the deprecated anon
  name) holds in code. Add a build-time check that no `SERVICE_ROLE`/secret leaks
  into `NEXT_PUBLIC_*`.
- **Database / RLS.** Review both migrations. Confirm RLS is ON for every table
  (rooms, messages, files, pinned_items, agent_runs, agents, etc.) and that policies
  enforce room membership / ownership. Verify the browser cannot write `agent_runs`
  (the README's core invariant). Add tests or SQL assertions for the key policies.
- **API authz + input validation.** For each route group (agents, files, health,
  pins, rooms, tool-calls): confirm authentication, authorization (membership
  checks), and schema validation on every input (extend `lib/api-validation.ts`).
  Add rate limiting on write/expensive endpoints. Ensure errors don't leak internals.
- **File handling.** Enforce upload size + MIME allowlist; prevent path traversal in
  storage keys; set short TTLs on signed download URLs; confirm files are scoped to
  the room/user. The OpenAI image-text extraction sends data to a third party —
  document this data-egress clearly and make it opt-in/configurable.
- **Tool-approval flow.** Verify protected actions cannot execute without approval
  and that the approval can't be forged or replayed.
- **Headers + transport.** Add security headers (CSP, HSTS, X-Content-Type-Options,
  Referrer-Policy, frame-ancestors) via Next config/middleware.

**Verify:** documented threat model + findings in `docs/reviews/`; new security
tests pass; secret-leak build check passes; `gitleaks` + `pnpm audit` clean (or
risk-accepted with justification). A red-team subagent attempts subprocess injection,
RLS bypass, and key-exposure and FAILS.
**Branches:** split per area, e.g. `harden/p1-subprocess-sandbox`,
`harden/p1-rls-audit`, `harden/p1-api-authz`, `harden/p1-file-uploads`.
**Critique gate:** Security Auditor (lead) + Adversarial Critic. Mandatory.

---

## Phase 2 — Code quality, type-safety & dead-code removal

**Goal:** consistent, strict, lint-clean, dead-code-free codebase.

**Tasks**
- Unify tooling at the root: ESLint (flat config) + Prettier + import sorting,
  shared across `apps/web`, `bridge`, `packages/shared`. Wire `pnpm lint`/`format`.
- Tighten TypeScript: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitAny`,
  consistent `tsconfig` extends from a base. Drive `any` toward zero; justify any
  remaining.
- Execute the Phase 0 dead-code decisions: delete the dead, abstract the duplicated
  (e.g. shared adapter logic, repeated validation, Supabase client setup), and move
  truly shared code into `packages/shared`. Each deletion references its evidence.
- Normalize naming/structure: consistent file naming, barrel exports where helpful,
  no cross-layer imports that violate the architecture (web ↔ bridge only via shared
  types + the DB contract).
- Add `knip` (or `ts-prune` + `depcheck`) to CI to keep dead code from returning.

**Verify:** `lint` + `typecheck` green with the stricter config; `knip` reports no
unused files/exports/deps (or documented allowlist); diff shows net code removed.
**Branch:** `harden/p2-quality-deadcode`
**Critique gate:** Code-Quality Auditor + Adversarial Critic (did any deletion
remove load-bearing code? is any "abstraction" premature?).

---

## Phase 3 — Automated testing & verification

**Goal:** a trustworthy safety net that gates every change.

**Tasks**
- Raise unit/integration coverage on the risk areas first: mention parsing, loop
  guards, discussion orchestration, adapter prompt construction, stale-run recovery,
  hallucination checks (bridge); API validation/authz, run cancellation, pinning,
  formatting (web). Set a coverage floor in CI (start realistic, ratchet up).
- Add **end-to-end** tests with Playwright for the core journeys: sign in → create
  room → add agent → send message → see agent reply; `@mention` + `@everyone`;
  `/discuss`; file attach + screenshot; pin/unpin; run cancellation; tool approval.
- Add a DB/RLS test layer (e.g. policy tests against a local Supabase) asserting the
  membership/ownership rules from Phase 1.
- Make tests deterministic: use the mock adapter for agent behavior in CI; no real
  network/LLM calls in the default suite. Seed data via `supabase/seed.sql`.
- Gate CI on test + coverage; add a Playwright job (can be its own workflow).

**Verify:** `pnpm test` + e2e green in CI; coverage ≥ floor; a deliberately
introduced regression is caught by the suite (prove the net works, then revert).
**Branch:** `harden/p3-tests-e2e`
**Critique gate:** QA/Verification agent (are tests meaningful or just coverage
theater? do they assert behavior, not implementation?).

---

## Phase 4 — UI/UX excellence & accessibility

**Goal:** the web app looks and feels production-quality and is accessible.

**Tasks**
- Audit the ~13 components (MessageBubble, MessageTimeline, ComposeBox, AgentRunCard,
  ActiveRunsPanel, FilesPanel, PinnedItemsPanel, ToolCallCard, sidebars, headers…)
  for: loading / empty / error states, optimistic updates, and stuck-run feedback.
- Accessibility to WCAG 2.1 AA: keyboard navigation, focus management, ARIA roles
  for the chat log/live regions (agent replies should announce via `aria-live`),
  color contrast, reduced-motion. Run `axe`/Lighthouse and fix violations.
- Responsive layout (mobile → desktop); verify the multi-panel layout degrades well.
- Consolidate styling into a small design system: tokens (color/spacing/typography),
  consistent components, dark/light theming (theme selection is already tested —
  build on it). Render states for markdown + math + code must be robust (the README
  calls out math/code-heavy answers as a pain point).
- Microcopy + errors that are human-readable and actionable.

**Verify:** Lighthouse a11y ≥ 95 and 0 critical `axe` violations on the core pages;
before/after screenshots in the PR; keyboard-only walkthrough recorded in the review.
**Branch:** `harden/p4-ux-a11y` (good candidate for a dedicated parallel terminal)
**Critique gate:** UI/UX & Accessibility Reviewer + Adversarial Critic.

---

## Phase 5 — Developer experience, containerization & onboarding

**Goal:** clone-to-running in <15 minutes; anyone can self-host.

**Tasks**
- **Containerize:** production `Dockerfile`s for `web` and `bridge` (multi-stage,
  non-root user, minimal base). A `docker-compose.yml` that brings up web + bridge +
  local Supabase for one-command local run. `.dockerignore`.
- **Dev container** (`.devcontainer/`) so contributors get a ready toolchain.
- **One-command setup:** a cross-platform bootstrap (keep the Windows `.bat`, add a
  POSIX `make`/`sh` path) that checks prerequisites, copies envs, starts Supabase,
  applies migrations + seed, and launches. Replace fragile steps with checks +
  helpful errors.
- **Env validation at boot:** validate required env vars (e.g. with `zod`) in both
  web and bridge; fail fast with a clear message naming the missing/!invalid var.
  Keep `.env.example` files authoritative and in sync.
- **Supabase without Pro (default):** make **local Supabase via Docker**
  (`pnpm dev:supabase`) the documented default for dev + solo use, and add a
  **self-hosted** `docker-compose` production path using the existing migrations +
  seed. Demote any hosted/cloud free-tier to an optional appendix (note its
  inactivity-pause behavior). No paid plan anywhere. Full detail:
  `04_HERMES_CAPABILITIES.md` → Workstream A.
- **Self-hosting guide:** `docs/SELF_HOSTING.md` covering the local-Docker default,
  the self-hosted production compose, required keys, where the bridge runs, and the
  trust model (the bridge runs CLIs on the host — make the security implications
  explicit).

**Verify:** a clean clone reaches a working app via the documented one-command path
on a fresh environment (prove it, e.g. in a container/CI smoke job); env validation
rejects a missing var with a clear error.
**Branch:** `harden/p5-dx-docker-onboarding`
**Critique gate:** DX & Docs Reviewer (follow the steps literally on a clean tree).

---

## Phase 6 — Observability, reliability & error handling

**Goal:** when it breaks in production, you can see why and it fails gracefully.

**Tasks**
- Structured logging (JSON, levels, correlation/run IDs) in bridge + web API; redact
  secrets and PII. Replace stray `console.log`s.
- Health/readiness: harden the existing `health` route; add a bridge heartbeat/health
  signal and surface worker liveness. Document the stale-run recovery behavior.
- Error tracking hooks (e.g. Sentry) behind config — opt-in, no-op without a DSN.
- Reliability: confirm graceful handling of agent CLI crashes/timeouts, Supabase
  disconnects, and queue backpressure. Ensure run state machine can't get stuck
  (claimed→running→done/failed/cancelled) and that cancellation actually kills work.
- Minimal runtime metrics (runs queued/active/failed, latency) exposed for scraping.

**Verify:** induced failures (kill a child mid-run, drop the DB, feed a bad agent
output) produce clean failed-state + actionable logs, not hangs or crashes; health
endpoints reflect reality.
**Branch:** `harden/p6-observability-reliability`
**Critique gate:** Adversarial Critic (chaos: what still hangs or loses a run?).

---

## Phase 7 — Documentation & open-source readiness

**Goal:** a newcomer understands and trusts the project from the repo alone.

**Tasks**
- Rewrite `README.md` for an external audience: what/why, screenshot/demo,
  architecture diagram, quickstart, link out to deeper docs. Keep it scannable.
- `docs/ARCHITECTURE.md`: the data-flow, the agent_runs queue contract, the bridge
  adapter model, the trust boundaries (with a diagram).
- OSS files: `LICENSE` (confirm intended license with the owner if unset),
  `CONTRIBUTING.md`, `SECURITY.md` (disclosure policy + the subprocess trust model),
  `CODE_OF_CONDUCT.md`, GitHub issue + PR templates, `CODEOWNERS`.
- `docs/adr/`: ensure every significant Phase 1–6 decision has an ADR.
- API reference for the route handlers and the `ContextPacketV1` contract; document
  every env var (web + bridge) in one table.
- A short "writing a new agent adapter" guide (extensibility is a selling point).

**Verify:** a fresh reader (a docs-reviewer subagent simulating a newcomer) can,
from docs only, explain the architecture and complete setup without reading source.
**Branch:** `harden/p7-docs-oss`
**Critique gate:** DX & Docs Reviewer + Adversarial Critic (newcomer persona).

---

## Phase 8 — Release engineering & v1.0

**Goal:** ship a credible, versioned, reproducible v1.0.

**Tasks**
- Finalize `CHANGELOG.md` (Keep a Changelog); adopt SemVer.
- Release workflow: tag `v1.0.0`, build + (optionally) publish container images via
  GitHub Actions, attach release notes. Pin/lock dependency versions for repeatable
  builds.
- Final full-suite green run (typecheck/lint/test/e2e/build/security) on `main`.
- Verify the entire Definition of Done checklist is satisfied with evidence linked.
- Refresh the demo GIF if the UI changed; ensure README badges (CI, license,
  release) are accurate.

**Verify:** tagged release exists; CI green on the tag; DoD fully checked with links
to the proving PRs/runs.
**Branch:** `harden/p8-release-v1`
**Critique gate:** Full panel — final adversarial sweep across security, quality,
UX, docs. Any High/Critical blocks the release.

---

## Phases 9–11 — Hermes-inspired capabilities (full spec in `04_HERMES_CAPABILITIES.md`)

These layer on after the security foundation (0–3) and ship inside v1.0. Each still
runs the full `/loop` with a mandatory `/critique` gate (Security Auditor is required
for 9 and 10). Run `/brainstorm <topic>` to design each before building.

- **Phase 9 — In-product agent memory.** Postgres-FTS, RLS-protected `agent_memory` +
  `user_profile` tables; agent-curated add/replace/consolidate via a bridge-validated
  `memory_op` event; **prompt-injection scanning** on every write; recall injected
  into `ContextPacketV1`; `/remember` + `/recall`.
  *Branch:* `feat/p9-agent-memory`. *Gate:* Security Auditor + Critic.
- **Phase 10 — First-class agent-to-agent interaction.** Roster + capabilities in the
  context packet; `handoff_requested` event → targeted run under the existing
  hop/round loop guards + cycle detection; `/handoff @agent`, `/agents`; documented
  protocol. *Branch:* `feat/p10-agent-interaction`. *Gate:* Security Auditor + Critic.
- **Phase 11 — In-product slash-command registry.** Central registry in
  `packages/shared`; RBAC tiers on `MemberRole`; parser extension in
  `mention-parser.ts`; commands `/discuss /remember /recall /summarize /handoff
  /agents /pin /personality /reset /help /commands`. *Branch:* `feat/p11-commands`.
  *Gate:* Critic + QA.
- **Phase 11 (added 2026-05-30) — User-created agents.** Users create/configure agents
  from the UI (`name`, `slug`, `avatar`, `provider`/`adapter_type`, `model`,
  `system_prompt`, `capabilities`, `reply_policy`, `tool_permissions`), persisted to the
  existing `agents` table and added as `room_members`; **admin+ only**, with edit/disable.
  Extend `AgentsPanel`/`RoomAgentsPanel`, the agents API, and `lib/api-validation.ts`.
  `/brainstorm` the design first. *Branch:* `feat/p11-user-agents`.
  *Gate:* Security Auditor + Critic + QA.

## At-a-glance backlog (the concrete starting findings)

| # | Finding | Phase |
|---|---------|-------|
| 1 | No CI (`.github/workflows` missing) | 0 |
| 2 | Stale `do/*` worktrees + branches; `graphify-out/`, `.launch-web.log` not ignored | 0 |
| 3 | Subprocess execution attack surface (bridge adapters) | 1 |
| 4 | Service-role Supabase key crossing web/bridge boundary | 1 |
| 5 | RLS policy completeness across all tables | 1 |
| 6 | Per-route authz + input validation + rate limiting | 1 |
| 7 | File upload limits, signed-URL TTL, third-party image egress | 1 |
| 8 | No root eslint/prettier; loose TS strictness; suspected dead code | 2 |
| 9 | Coverage gaps; no e2e; no RLS tests | 3 |
| 10 | UX states + WCAG AA accessibility + math/code rendering robustness | 4 |
| 11 | No Dockerfile/compose/devcontainer; fragile onboarding; no env validation | 5 |
| 12 | Logging/health/error-tracking/reliability gaps | 6 |
| 13 | Missing LICENSE/CONTRIBUTING/SECURITY/ARCHITECTURE/ADRs | 7 |
| 14 | No release process/CHANGELOG/versioning | 8 |
| 15 | Supabase must run local-Docker (no Pro); add self-host compose | A (P5) |
| 16 | In-product agent memory (Postgres FTS, injection-scanned) | 9 |
| 17 | First-class agent-to-agent interaction + hand-off | 10 |
| 18 | In-product slash-command registry + RBAC | 11 |

Re-confirm each against the live repo during Phase 0 before acting.
