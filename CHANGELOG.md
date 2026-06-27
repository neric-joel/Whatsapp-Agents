# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — local-only rewrite (no Supabase, no Docker, no login)

AgentRoom is now a **local, single-user desktop app**. It runs entirely on `localhost`
against a local SQLite database + files folder under `~/.agentroom`
(`%APPDATA%\AgentRoom` on Windows); Supabase, Docker, and all auth/login were removed.

- **Added — Connections (the headline feature).** Auto-detect installed agent CLIs
  (Claude Code, Codex, Gemini, Antigravity) by probing `PATH` + `--version`, and
  register your own (bring-your-own CLI) by binary path, args, and output format.
  Profiles live in `~/.agentroom/config.json`. **Auth is deferred to each CLI** —
  AgentRoom asks for no API keys; it just runs the binary, which uses its own login.
  Add a connected CLI to a room and it replies as a named participant. See
  [`docs/CONNECTING_CLIS.md`](docs/CONNECTING_CLIS.md).
- **Changed — data layer.** New `@agentroom/db` (better-sqlite3): the full schema +
  the `agent_runs` work queue (status machine + atomic claim preserved) ported to
  SQLite; uploads saved to a local `files/` folder; realtime replaced by client
  polling of the read APIs.
- **Removed.** `@supabase/*`, the `supabase/` folder, Dockerfiles/compose, the login
  pages and auth middleware, and the RLS/db-tests + docker CI workflows.
- **Fixed.** better-sqlite3 is now externalized from the Next.js server build (was
  webpack-bundled, crashing every DB route); CLI detection routes Windows `.cmd`/`.bat`
  shims through `cmd.exe` (was failing with `spawn EINVAL`).

## [1.1.0] - 2026-06-01

Four post-1.0 campaigns, each landed via a CI-green PR and an adversarial review, integrated onto
`main` through a single release branch.

### Added

- **Real team collaboration via `/discuss`** (ADR-0011). Replaces the old
  individual→critique→consensus flow with a genuine team: a coordinator **decomposes** the
  problem and **assigns sub-tasks by capability** onto a shared blackboard; agents **execute their
  part while seeing and building on their teammates' work**, then **cross-review**; a coordinator
  **converges on one answer with attribution**. An anti-sycophancy **dissent** stage runs when no
  one has substantively challenged, so the team never rubber-stamps. The parallel-blindness bug
  (phase-N agents couldn't see peers) is fixed by a discussion-scoped context query.
- **Adversarial `/debate`** — agents argue distinct assigned positions (argue → rebut), then a
  coordinator **adjudicates a winner** (not a merge).
- **Bring-your-own CLI / API-key Providers** (ADR-0010). A per-user, RLS-isolated keychain
  (`user_credentials`), secrets **AES-256-GCM encrypted at rest** and never returned to the
  browser; bind a credential to an agent and the bridge injects exactly that key into the
  adapter's child env at spawn. Managed in **Settings → Providers**.
- Fresh, current **demo GIF** (team `/discuss` + dark theme) and a polished, public-facing README.

### Changed / Hardened

- **Stress/chaos + race-condition hardening** — fixed a terminal-write clobber where a
  post-completion follow-up could flip a completed run to failed (R3) and related concurrency/F6
  issues; hardened stale-run recovery and added POSIX detached **kill-tree** on cancel/timeout.
- **Output hardening** — deduped hallucination reasons (killed a false "high"-confidence inflation
  + a React duplicate-key render fault); fixed two `js/polynomial-redos` findings; the codex
  adapter no longer leaks non-JSON process noise into replies.
- **De-cluttered the public repo** — untracked internal AI/build-process tooling (kept on disk +
  in history): `CLAUDE.md`, `docs/production-hardening/`, `docs/reviews/`, `.claude/`, and the
  internal runner scripts.

### Security

- **`/discuss` room-isolation guard** — the server is the sole author of `metadata.discussion`;
  a client can no longer forge it to pull another in-room discussion's transcript into an agent's
  context (the collaboration HIGH, fixed before merge). All subprocess/RLS/credential invariants
  preserved.

## [1.0.0] - 2026-05-31

First production-ready release. A pre-1.0 hardening effort turned the MVP into a
self-hostable, OSS-ready project across eleven phases, each landed via a CI-green PR and
an adversarial review. A final 10-dimension pre-v1.0 security + correctness sweep
returned **GO** (0 Critical, 0 confirmed High). Highlights by phase:

### Added

- **In-product slash commands + RBAC (Phase 11).** A central command registry
  (`COMMAND_REGISTRY`) drives both the parser and the API; the v1 set is `/help`,
  `/commands`, `/discuss`, `/remember`, `/recall`, `/handoff`, `/agents`, `/pin`,
  `/reset`. Role tiers (`owner > admin > member`) are enforced **server-side**;
  `/help` lists exactly the caller's allowed commands; `/reset` (admin+) clears a
  room's rolling agent context reversibly (no data deleted).
- **User-created agents (Phase 11).** Admins can create / edit / disable agents from
  the UI (`POST/PATCH/DELETE /api/agents`), attached to a room as members. A user-set
  `system_prompt` reaches a CLI via stdin only (never argv); `adapter_type` is
  allowlisted and `tool_permissions` cannot grant auto-approval.
- **First-class agent-to-agent interaction (Phase 10).** Agent `capabilities` + a
  peer `roster` in `ContextPacketV1`; an agent-emitted `handoff_requested` event
  creates a targeted peer run under hop/round caps + cycle detection; `/handoff @agent`
  and `/agents` slash commands.
- **In-product agent memory (Phase 9).** `agent_memory` + `user_profile` tables
  (Postgres FTS recall) with service-role-only writes; the bridge validates and
  injection-scans every agent `memory_op` (stored as data, never instructions);
  `/remember` + `/recall` + a Memory panel.
- **Release engineering (Phase 8).** A tag-triggered `release.yml` workflow that
  re-runs the full gate, builds both images, and publishes a GitHub Release (inert
  until a human pushes a semver tag).
- **Observability & reliability (Phase 6).** Structured, secret-redacted JSON logging
  shared by web + bridge; web `/api/health` database-readiness ping; a bridge
  `/healthz` + `/metrics` HTTP server (Prometheus exposition); opt-in error tracking
  (no-op without a DSN); runtime metrics (runs started/completed/failed/cancelled +
  latency); documented run state machine + stale-run recovery
  (`docs/OBSERVABILITY.md`).
- **Developer experience & containerization (Phase 5).** Multi-stage non-root
  Dockerfiles for web + bridge, `docker-compose.yml`, `.devcontainer/`, cross-platform
  bootstrap, boot-time env validation, and `docs/SELF_HOSTING.md`.
- **Testing (Phase 3).** Coverage floors in CI, Playwright e2e scaffold, and pgTAP
  RLS/policy tests.
- **CI & repo hygiene (Phase 0).** GitHub Actions (verify, security/secret-scan,
  CodeQL, e2e, db-tests, image build), Dependabot, `.editorconfig`, `.nvmrc`,
  branch protection + pre-push hook.
- **Open-source readiness (Phase 7).** `LICENSE` (MIT), `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`, issue templates,
  `docs/ARCHITECTURE.md`, and `docs/adr/`.

### Changed

- **Code quality (Phase 2).** Root ESLint flat config + Prettier + import sorting;
  stricter TypeScript (`noUncheckedIndexedAccess`); `knip` dead-code gate.
- **UI/UX & accessibility (Phase 4).** WCAG 2.1 AA pass (keyboard nav, focus
  management, ARIA live regions, contrast), reduced-motion support, render-state
  coverage.

### Fixed

- **Realtime UPDATE propagation (R2).** Message UPDATE events (edits, soft-deletes,
  hallucination accept/reject) are now upserted into the live timeline instead of
  being dropped, so peers no longer keep rendering stale/"deleted" content until a
  reload (`useMessages.ts`).
- **Authenticated room-page accessibility.** Fixed three pre-existing WCAG 2.1 AA
  violations surfaced by a new authenticated axe scan: a role-less `aria-label`
  ("Active agents"), low-contrast message timestamps, and low-contrast agent-avatar
  initials. axe now reports 0 serious/critical on `/auth` and the room page.

### Security

- **Security hardening (Phase 1).** Subprocess sandbox (`shell:false`, stdin
  system-prompt, binary allowlist, minimized env, output cap); storage RLS scoped to
  room membership; CSRF/Origin checks + rate limiting + fail-closed middleware +
  security headers; error-message redaction; opt-in third-party image egress.
- **Cross-tenant agent-column exposure (R1).** Restricted column-level SELECT on
  `public.agents` so the browser (`authenticated`/`anon`) roles can no longer read
  any tenant's `system_prompt` or `tool_permissions` (Phase 11 lets users author
  `system_prompt`); the global agent roster keeps working via 13 safe columns. The
  server/service-role path is unaffected. Verified against a live DB (pgTAP +
  role-level SQL + real PostgREST HTTP); migration `20260531000004_agents_column_privs.sql`.

[Unreleased]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/neric-joel/Whatsapp-Agents/releases/tag/v1.0.0
