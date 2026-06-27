# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.3.0] - 2026-06-27

### Added — production run path

- **`pnpm start`** — one cross-platform command for end users. It installs deps if needed,
  builds the web app (`next build`), starts the production server (`next start`) and the
  bridge (non-watch), waits until `http://localhost:3000` is ready, opens your browser, and
  tears the whole stack down on Ctrl-C. No more running the dev server in front of users.
  Contributors keep `pnpm dev` (watch mode). `pnpm build` is exposed for pre-building.

### Changed — launcher cleanup

- `start-agentroom.bat` is now a thin wrapper around `pnpm start`; its port-killing,
  `.next`-cache-wiping, and zombie-`tsx`-reaping logic is gone — a freshly built app started
  with `next start` doesn't need it.
- Removed `create-desktop-shortcut.ps1` and the now-unused `scripts/check-web-ready.{ps1,sh}`.
- README / CONTRIBUTING / Makefile / `scripts/bootstrap.sh` / `docs/SELF_HOSTING.md` now point
  end users at `pnpm start` and contributors at `pnpm dev` (and drop stale Supabase/Docker
  setup steps that referenced removed scripts).

### Security — issue #67 closed

- **`working_dir` hardening.** A session's working folder is validated before it is stored
  (and before it can ever become a spawned CLI's `cwd`): absolute path only, UNC/device paths
  rejected, **realpath**-canonicalized and required to be a real directory inside an allow-root
  (defaults to your home dir; override with `AGENTROOM_WORKSPACE_ROOT`). realpath defeats `..`
  traversal and symlink/junction escape; a sensitive-dir denylist (`~/.ssh`, `~/.aws`,
  `~/.gnupg`, `~/.config`, the app's own `~/.agentroom`, …) and an over-broad-root guard add
  defense-in-depth. New `validateWorkingDir` in `@agentroom/db` with full test coverage.
- **Canary precision.** The grounding gate no longer false-flags a generic third-party mention
  ("Postgres is what most apps use") — it suppresses only on an explicit generic subject — while
  still flagging real, natural storage hallucinations ("messages are stored in Supabase"). The
  citation heuristic scans the whole sentence for a URL. Regexes stay linear (no ReDoS); the
  fail-safe is unchanged. See [docs/CANARY_LOOKAHEAD.md](docs/CANARY_LOOKAHEAD.md).

### Fixed

- **Windows production build.** `next build` failed on Windows because `@vercel/nft` evaluated
  `os.homedir()` (used by server code) and scanned the home dir, hitting the protected
  `Application Data` junction (EPERM). Disabled `outputFileTracing` (its `.nft.json` manifests
  are unused without `output: 'standalone'`), so `pnpm start` builds cleanly on Windows.

## [1.2.0] - 2026-06-27

### Added — v2: trustworthy, Cowork-style workspace

- **Agent grounding.** Every agent prompt is prefixed with authoritative facts about the
  real local architecture (built from the live `@agentroom/db` paths), so agents stop
  hallucinating their own storage (e.g. claiming Supabase/a ChatGPT workspace) and answer
  "local SQLite under ~/.agentroom" instead. See [docs/CANARY_LOOKAHEAD.md](docs/CANARY_LOOKAHEAD.md).
- **Canary lookahead** (HalluCana-inspired). A pre-commit gate screens every reply and
  flags claims that contradict the known environment; a flagged/unverified reply is
  labelled `[UNVERIFIED]` to peer agents so a wrong claim can't become another agent's
  premise. Fail-safe. Canary badges (✓/⚠/⚑) on agent messages.
- **Cowork-style sessions.** Open a working folder; sessions are named, renamable, and
  resume across restarts. Rooms belong to a session. See [docs/WORKSPACE_MODEL.md](docs/WORKSPACE_MODEL.md).
- **Pick your agents.** No pre-built agents are forced on a room; you select which
  connected CLIs join from a catalog at room setup. Rooms are renamable. A connected CLI
  is one agent reused across rooms.
- **Cowork surfaces.** An Outputs panel (room files) alongside the existing progress
  (run cards) and memory surfaces.
- **Fixed.** The Connections page rendered a duplicate sidebar (a double-`AuthGuard`),
  pushing the panel + its Connect buttons off-screen — now a single shell.
- **Eval harness** (`scripts/eval/run-eval.mjs`) + [report](docs/reviews/eval-report.md):
  live grounding 4/4, hallucination-bait 2/2 resisted, concurrency stable.

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
