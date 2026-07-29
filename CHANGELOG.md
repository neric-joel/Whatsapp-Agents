# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **`npx agentroom` now pins the source it builds by content, not by name.** The bin
  fetched `archive/refs/tags/v<version>.tar.gz` and checked only that the result *looked*
  like AgentRoom before installing, building and executing it — so force-moving a released
  tag changed what every future `npx agentroom@X.Y.Z` ran, while the npm artifact anyone
  audits stayed byte-identical. `publish-npm` now records the released commit and the
  SHA-256 of its GitHub source archive into the published `package.json`, and the bin
  fetches `archive/<commit>.tar.gz` and refuses to extract bytes whose digest does not
  match. An absent or malformed pin is a hard failure (`AGENTROOM_ALLOW_UNVERIFIED_SOURCE=1`
  is the documented opt-out for running the bin from a checkout; there is none for a
  mismatch). The primary download's resolved redirect target must now be `https:` on a
  GitHub host — previously only the `AGENTROOM_SOURCE_TARBALL` override rejected `http://`,
  and nothing looked at where a redirect actually landed. (ADR-0014, amended)
- **A release that cannot publish to npm now fails instead of reporting success.** The
  publish job downgraded a missing `NPM_TOKEN` to a `::notice` and skipped, so every tag
  from v1.0.0 to v1.6.0 produced a green run and a GitHub Release while publishing nothing
  — six versions, unnoticed, with the README pointing every reader at `npx agentroom`. The
  skip branch is gone, and a new `publish-preflight` job requires the secret **before** the
  GitHub Release is created, so the ordinary failure stops the run while nothing
  user-visible exists.

## [1.6.0] - 2026-07-26

Cleared the entire tracked backlog (every open issue and PR), then ran an adversarial
review sweep over the result — parallel reviewers by lens, each finding cross-examined by
skeptics instructed to refute it — and fixed the twelve defects that survived. All twelve
were live with a fully green test suite, which is the honest headline: the gates said the
shape was right, not that the thing worked.

### Added

- **Agents now run in the session's working folder.** The folder was validated, persisted,
  displayed, and used as the outputs root, but `getWorkingDir()` returned `null`, so every
  CLI actually ran in the bridge's own directory. `ContextPacketV1` carries `working_dir`,
  `buildContextPacket` reads it from the room's session, and `SubprocessAdapter` routes it
  through the unchanged `resolveSpawnCwd`, which re-validates (realpath, allow-root,
  sensitive-dir denylist) immediately before `spawn`. Wiring this revealed that the
  spawn-time re-validation added for #71 had never once run against a real folder. (#86)
- **Keyboard and ARIA polish** for the deferred v1.4 audit findings: the mention dropdown
  is a real combobox/listbox with arrow-key navigation, the manage-agents panel is a
  focus-managed dialog that Escape closes and returns focus from, markdown tables render
  semantic `th[scope=col]`, a global `:focus-visible` ring is driven by each theme's
  `--focus-ring` token, notices sit in always-mounted live regions, and destructive
  confirms are themed dialogs instead of `window.confirm`. Axe stays at 0 serious/critical,
  now also scanned with the dropdown and dialog open. (#76)
- **`docs/LINKEDIN_POST.md`** — a launch post drafted from the same honesty rule as the
  writeup: nothing in it is a claim the repo can't back.

### Fixed

- **Uploaded files are served inert.** `image/svg+xml` was on the upload allowlist and
  `signed-download` served stored bytes with `Content-Disposition: inline`, so opening an
  SVG — one click from the Outputs panel, which links every file with `target=_blank`
  — executed embedded `<script>` in the app's own origin. The CSP is no mitigation
  (`script-src` includes `'unsafe-inline'`), and because auth is a fixed local user with
  no-op role checks, that script held full same-origin API authority, including
  `POST /api/connections` to register a CLI profile the bridge would later spawn. Inline is
  now a safe MIME allowlist (png/jpeg/gif/webp/text-plain); everything else is an
  attachment, served with `default-src 'none'; sandbox`. SVG uploads stay allowed on
  purpose — agents produce legitimate diagrams, so the serving is inert, not the artifact
  rejected.
- **Windows shim spawning and process-tree kills.** A `.cmd` shim whose path contained a
  space could not be spawned at all — `cmd /s /c` stripped the quoting — so any CLI under
  `C:\Program Files` was unreachable. Cancel, timeout, and the output cap killed only the
  `cmd.exe` wrapper, orphaning the real agent process; they now `taskkill /T /F` the tree,
  matching the POSIX negative-pid guarantee. The `--version` probe had the same
  wrapper-only kill. The child-env allowlist compared names case-sensitively on a platform
  where env names are case-insensitive. Injection safety was verified directly rather than
  assumed: a metacharacter payload reaches the shim as one literal argv token and executes
  nothing.
- **`@`-mention autocomplete never worked** — the code read `m.agents`, the API returns
  `agent`. This is the same singular/plural mismatch that made the agents panel
  permanently claim "No agents in this room yet", and it had silently come back. The shape
  is now pinned by shared types plus a test that fails on the plural spelling, so a third
  recurrence is a type error rather than a silent empty list.
- **Switching rooms showed the previous room's messages** until the first poll landed, and
  a response for the old room could land after the switch. State is masked on room change
  and a sequence guard drops stale responses.
- **The optimistic message never rendered** — it was added and cleared within the same
  React batch. Optimistic rows now survive until the matching server id arrives.
- **A message referencing an unresolvable file id refetched the whole room file list every
  1.5 s, forever.** Missing ids are negative-cached.
- **The runs endpoint had no `LIMIT`** despite a comment claiming a 200 cap, re-delivering
  every historical run on every poll. The comment is now true.
- **The saved theme only applied where `ThemeSwitcher` happened to mount**, so other pages
  and first paint ignored it. Applied at the root before paint.
- **`ComposeBox` read a private rooms cache**, so its placeholder kept the pre-rename name.
- **Timeline auto-scroll fought manual scrolling.** The effect scrolled to the bottom on
  every poll re-render, yanking back anyone reading while agents worked. It now scrolls
  only when the user was already near the bottom, keyed on the last message id rather than
  array identity. The agents panel no longer flashes "Loading agents…" on every refetch.
  (#99)
- **Edited messages are marked.** The messages payload carries `updated_at`, an edited
  message shows `(edited)`, and an edited `/discuss` kickoff renders its edited content
  instead of silently displaying the original command from metadata. (#98)
- **Agent bubbles follow the theme.** Provider colors were hard-coded light, so they stayed
  light while the chrome went dark. Provider identity is now an accent over theme tokens.
  (#97)
- **`/discuss` phase prompts collapse to a chip** that expands on click, instead of
  dominating the timeline as full gray blocks. (#96)
- **Canary false positive on discussion topics.** A `/discuss` about choosing between
  SQLite and Postgres had its converged answer flagged for claiming this app uses Postgres.
  A grounding hit on a backend term the discussion topic itself names now downgrades to
  `unverified` rather than `flagged`. The exception is context-scoped, not term-scoped: no
  backend noun is whitelisted, an explicit claim about this app still flags, and every
  pre-existing canary test passes unmodified. (#95)
- **`GET /api/rooms/:roomId/messages` returned `200 []` for a nonexistent room**, making it
  indistinguishable from an empty one. It returns `NOT_FOUND`, after the membership check so
  it can't become an enumeration oracle. (#82)
- **Message `content` had no upper bound** (a 1 MB body was accepted). Both send and update
  schemas cap at 8000 characters, the limit the memory and handoff paths already used. (#81)

### Security

- **The Origin/CSRF check no longer trusts the `Host` header.** `isForbiddenCrossOrigin`
  accepted any `Origin` equal to `req.nextUrl.origin`, which Next derives from `Host`, so a
  DNS-rebound page could present a matching `Origin` and reach the mutating API. The
  implicit self-origin is pinned to loopback hostnames; explicitly configured origins still
  pass. (#90)

### Changed

- **The CI `audit` job is enforcing.** It carried `continue-on-error: true` under ADR-0009
  decision D3 while a dev-toolchain advisory was outstanding, and had been red on every PR.
  With every high advisory cleared, the allowance is retired and `pnpm audit --audit-level
  high` is a real gate. (#78)
- **Dev-dependency majors:** TypeScript 6, ESLint 10, `@types/node` 25, vitest 4.1.10.
  TypeScript is held at 6.0.x deliberately — `typescript-eslint@8` peers `<6.1.0`. Targeted
  overrides for `vite`, `postcss`, `sharp`, and `brace-expansion` live in
  `pnpm-workspace.yaml`, since pnpm 11 no longer reads them from `package.json`. Supersedes
  dependabot PR #104. (#78)
- **Docs corrected where the code moved past them:** `HOW_IT_WORKS.md` and
  `WORKSPACE_MODEL.md` D-W5 no longer say the working folder isn't the spawn `cwd`,
  `CONTRIBUTING.md` no longer calls the audit job informational, and `WRITEUP.md` drops the
  working-folder caveat from its limitations list.

## [1.5.0] - 2026-07-04

The publishable-launch release: every live doc verified against the code
(ADR-0013), a real npm install path with provenance (ADR-0014), a technical
writeup, a re-recorded demo, and a fix for every Critical/High/Medium finding
from four adversarial review panels along the way.

### Added

- **`npx agentroom`** — AgentRoom is now publishable to npm as a tiny bootstrapper
  (ADR-0014). It downloads the source for its own exact release tag into
  `~/.agentroom/app/<version>/`, checks Node and pnpm (attempting `corepack enable`
  automatically if pnpm is missing), and runs the existing `scripts/launch.mjs` — so
  `npx agentroom` does exactly what the git quickstart does, minus the clone. The
  npm artifact contains **no app code** (bin + README + LICENSE only); the GitHub
  tag stays the single source of truth. `release.yml` gains a tag-gated
  `publish-npm` job that publishes with npm provenance (OIDC) whenever `NPM_TOKEN`
  is configured, and skips with a visible notice otherwise so the GitHub Release is
  never blocked.
- **`docs/WRITEUP.md` + `docs/LAUNCH_POST.md`** — a technical launch writeup
  (grounding + the canary lookahead gate, the `/discuss` redesign and dissent stage,
  the subprocess trust model and its limits, injection-scanned memory) and a
  Show-HN draft. Every claim independently fact-checked against the repo.
- **Fresh demo GIF** recorded on this release's UI: connecting the detected Claude
  Code + Codex CLIs, a full real-CLI `/discuss` (plan → execute → cross-review →
  attributed team answer), and a dark-theme switch. The old GIF predated the
  local-only rewrite and still showed a "Sign out" button.

### Fixed

- **The `/discuss` kickoff bubble now shows what you typed.** The timeline used to
  render the internal coordinator phase prompt as the *user's own message* (the
  stored content is the agents' trigger and stays unchanged — this was a display
  bug). User bubbles, reply previews, and new pins now show the literal typed text
  (`/discuss …` or an `@everyone …?` question), which the server now records
  alongside the trigger (#94 + follow-ups from the final review sweep).
- **`packages/shared` tests now run in CI.** The `verify` gates invoke
  `test:coverage`, which `@agentroom/shared` didn't define — so its 25 tests
  (including the canary suite) were silently skipped by `--if-present`. One-line
  script addition.
- **Release safety:** the tag-must-match-`package.json` check now runs
  unconditionally in the release `verify` job (it previously lived only inside the
  npm-publish job, which skips entirely when `NPM_TOKEN` is absent — and the new
  tag-immutability ruleset would have made a mis-tagged release unfixable).
- **npx bootstrapper hardening** (final security sweep): pnpm/corepack/tar probes
  pin their working directory (Windows resolves bare commands from the invocation
  cwd before `PATH`); an empty-but-set `AGENTROOM_APP_CACHE` falls back to the
  default instead of rooting the cache in the current directory; deleting a cached
  app that is still running fails with a friendly message instead of a raw
  `EBUSY` stack; orphaned `.extract-*`/`*.part` leftovers from hard-killed runs are
  swept on startup.
- **Gemini connections no longer send a stray `-` token with every prompt.** The
  auto-detect catalog invoked gemini as `--prompt -`, but gemini *appends* the
  `--prompt` value to the stdin input — so every reply carried a meaningless
  trailing `-`. The catalog now passes a real trailing instruction, and existing
  `config.json` gemini profiles that still carry the old catalog snapshot are
  repaired automatically on load.
- `/help` no longer describes `/debate` as a plain alias of `/discuss` — it runs the
  adversarial flow (assigned positions → argue → rebut → a coordinator adjudicates a
  winner), and now says so.

### Changed — claims now match reality (docs truth pass, ADR-0013)

- Recorded the v1.2.0 local-only rewrite as **ADR-0013** (supersedes ADR-0001/0004)
  and aligned every live doc with it: `SECURITY.md`'s trust model now describes the
  real boundaries (write path, localhost-only, subprocess env allowlist + provider
  pass-through, dormant tool-call denylist) instead of the removed
  Supabase/RLS/Docker stack; `CONTRIBUTING`, `OBSERVABILITY`, issue templates,
  `CODEOWNERS`, and stale code comments were corrected to match.
- README: the themes bullet now states exactly what is verified — 7 themes, core
  screens axe-clean (0 serious/critical WCAG 2.1 A/AA violations) in CI — instead
  of "WCAG 2.1 AA verified".
- More falsifiable absolutes replaced with the scoped truth (final review sweep):
  "Nothing leaves `localhost`" → AgentRoom itself makes no network calls and serves
  only `127.0.0.1`; what leaves the machine is what your own CLIs send to their
  providers. `ARCHITECTURE.md` now describes the real `/discuss` phase machine
  (plan → execute → integrate → [dissent] → converge) instead of the legacy
  pre-ADR-0011 one. The npm package description no longer says "nothing leaves
  your machine".

### Deferred (tracked, not blocking)

- **#90** — pin the Origin/CSRF self-check to localhost hosts (DNS-rebinding
  hardening). **#95** — canary false-positive when a discussion's *topic* names a
  database backend. **#96** — collapse the gray phase-prompt blocks in `/discuss`
  timelines. **#97** — Dracula bubble contrast. **#98** — edited messages show no
  indicator (a content-PATCH on a `/discuss` kickoff is invisible in the bubble).
  **#99** — the timeline auto-scrolls to the bottom on every poll, fighting a
  manual scroll-up while agents are running.

## [1.4.1] - 2026-06-28

Pre-launch honesty pass: make the advertised feature list match what a new user can
actually do with the bundled CLIs. No feature was removed that worked — only claims that
didn't, plus one real UI bug fix.

### Fixed

- **Room "Agents" panel never listed agents** (#84). `AgentsPanel` read `member.agents`
  (plural) but the members API returns `member.agent` (singular), so its active-agent
  filter dropped every member and the panel always showed "No agents in this room yet" —
  even with agents actively replying. Fixed the field, extracted the mapping to
  `lib/agents-panel.ts` with a regression test, and added a **mute / unmute** toggle (the
  members API already enforced `muted`, but there was no way to reach it from the UI).

### Changed — claims now match reality

- **Removed `antigravity` from the auto-detect CLI catalog** (#80). It is an editor/IDE
  launcher (`--diff` / `--merge` / `--goto` / `--new-window`), not a conversational agent,
  so it could never reply in a room; auto-detecting it as "ready" was misleading. A catalog
  test now asserts only conversational CLIs (Claude Code, Codex, Gemini) are offered.
- **Retracted the "tool-approval for protected actions" feature claim** (#83). The approval
  machinery (`tool_calls`, `ToolCallCard`, approve/deny routes, run-worker wait branch)
  exists as scaffolding, but **no bundled adapter emits the `tool_call_requested` event**
  that fires it, so the gate never triggers in the shipped product. Removed the README
  bullet; `docs/ARCHITECTURE.md` now marks the gate "not yet wired"; the code keeps the
  scaffolding for a future producer.
- **Corrected the working-folder description** (#86). A session's working folder is the
  outputs root and is validated when saved, but it is **not yet wired as each agent CLI's
  spawn `cwd`** (agents run in the bridge's working directory). `docs/HOW_IT_WORKS.md` and
  the session UI copy no longer imply agents "work in" that folder; the spawn-time
  re-validation (`resolveSpawnCwd`, #71) remains as defense-in-depth for when `cwd` is wired.

## [1.4.0] - 2026-06-28

A full-system check → close-issues → major-upgrade → repo-hygiene sweep on top of v1.3.0.
Five CI-green PRs (#72–#75, #77) plus this release; each landed through an adversarial
review with zero open Critical/High findings. Issues **#71, #65, #63, and #46 closed**.
Proven by a fresh clean-clone, new-user walkthrough: `pnpm start` builds and runs the
Next 16 stack, two real CLIs (Claude Code + Codex) reply to one message as separate
participants, and the storage-grounding question is answered "local SQLite" with the
canary badge **verified** (no Supabase/cloud hallucination).

### Changed — dependencies (React 19 + Next 16)

- **React 18 → 19 and Next.js 14 → 16** (#77, closes #63 / #46). Migrated 14 → 15 → 16
  deliberately: async request APIs (`params` / `searchParams` are now awaited),
  `serverComponentsExternalPackages` → `serverExternalPackages`, dropped the removed
  `experimental.instrumentationHook` and `outputFileTracing` flags, and moved to the
  React 19 types (ref-as-prop). The web build pins `next build --webpack` because
  Turbopack cannot yet honour the `.js` → `.ts` extension alias this monorepo relies on.
  The Windows `@vercel/nft` EPERM build failure is resolved by redirecting the file-trace
  HOME **only during `next build`** (a `next.config` phase-function), leaving the
  `next start` / `next dev` runtime HOME untouched.

### Security

- **Web server now binds to `127.0.0.1` only** (was `0.0.0.0`). AgentRoom is a
  single-user local tool that ships without auth precisely *because* it only listens on
  localhost; binding every interface left the full API — including the endpoint that
  spawns local agent CLIs — reachable from the LAN. `next start` / `next dev` now pass
  `-H 127.0.0.1`, matching the already-localhost-bound bridge health server.
- **`working_dir` re-validated at spawn time** (#74, closes #71). The stored working
  folder is canonicalised and re-checked against the allow-root *again* at the moment a
  CLI is spawned — not only when it is saved — closing a time-of-check/time-of-use window
  if the path changed or a symlink/junction was swapped between save and run. New
  `resolveSpawnCwd` + `WorkingDirRevalidationError` in `@agentroom/db`.
- **Run reliability + input hardening** (#73). Run finalisation is now an atomic,
  status-guarded transaction, so a cancel mid-flight can no longer race a completed reply
  into the timeline; bridge shutdown aborts all in-flight runs with a bounded drain; the
  hallucination scan is bounded (`MAX_SCAN_CHARS` / `MAX_SENTENCES`) against pathological
  input; and the signed-upload route validates the room, asserts path containment, and
  unlinks the file if the DB insert fails.

### Fixed

- **Multi-word @mentions were silently dropped** (#75). Mention parsing is unified in a
  single `@agentroom/shared` module shared by the web app and the bridge, fixing agents
  whose display names span multiple tokens and removing the duplicated parser.

### Maintenance

- **Repo + code cleanup** (#72, closes #65). Removed dead code, aligned docs with the
  local-only architecture, tightened tests, and addressed the deferred Medium/Low critique
  follow-ups that had been tracked under #65.
- Pruned the merged upgrade branch and stale remote-tracking refs.

### Deferred (tracked, not blocking)

- **#76** — keyboard / ARIA polish for the mention & agent dropdowns, tables, and
  `focus-visible` states (v1.4 accessibility-audit items UX1–8).
- **#78** — dev-only dependency majors (TypeScript 6, ESLint 10, `@types/node` 25, and a
  `vite ≥ 8.0.16` advisory reachable only through the test toolchain).

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

[Unreleased]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.6.0...HEAD
[1.6.0]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/neric-joel/Whatsapp-Agents/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/neric-joel/Whatsapp-Agents/releases/tag/v1.0.0
