# Security Policy

AgentRoom runs large-language-model **command-line tools as subprocesses on the host**
that runs the bridge daemon. That makes its trust model unusual — please read the
trust model below before deploying it anywhere multi-tenant or internet-facing.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately via GitHub's **[Report a vulnerability](https://github.com/neric-joel/Whatsapp-Agents/security/advisories/new)**
(Security → Advisories → Report a vulnerability). Include:

- a description and the impact,
- steps to reproduce (PoC if possible),
- affected component (web / bridge / db (`packages/db`) / CI) and version/commit.

We aim to acknowledge within **7 days** and to agree on a disclosure timeline with you.
Please give us a reasonable window to ship a fix before any public disclosure. There
is no paid bug-bounty program; we credit reporters in the release notes unless you
prefer to remain anonymous.

## Supported versions

Security fixes target the `main` branch and the latest tagged release (currently the
`v1.x` line). Older tags are not maintained — upgrade to the latest release.

## Trust model (read this before you deploy)

- **The bridge executes CLIs on its host.** Real agent adapters (`claude-code`,
  `codex-cli`, and any CLI you connect) spawn host-installed binaries as child
  processes. Anyone who can create an agent + send a message in a room the bridge
  serves can cause those CLIs to run. **Run AgentRoom only on a machine whose users
  you trust, and only connect CLIs you trust.** Until you connect a CLI or create an
  agent on the `claude-code`/`codex-cli` adapter types (which resolve installed
  binaries from `PATH`), only the built-in **mock adapter** runs. See
  [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full boundary.
- **Subprocess hardening**: commands are spawned with `shell: false` and an
  argv array (no shell string, no command interpolation); agent-controlled
  `system_prompt` is delivered via **stdin**, never argv; the binary is resolved
  from trusted host configuration (a `*_BIN` env var, `PATH`, or your own
  Connections entry) — **never from agent data**; the child environment is reduced
  to an allowlist — base OS vars plus non-secret provider *config* the CLIs read
  (`ANTHROPIC_BASE_URL`, `AWS_REGION`, …) — while credential-shaped names
  (`*_KEY`, `*APIKEY*`, `*_TOKEN`, `TOKEN`, `*SECRET*`, `*PASSWORD*`, `*CREDENTIAL*`,
  `*PRIVATE_KEY*`, `*SUPABASE*`, `*SERVICE_ROLE*`, `BRIDGE_*`) are denied outright,
  ahead of the allowlist, so nothing else from the bridge's own environment is
  forwarded (the only secrets a child sees are ones you explicitly bind: a BYO
  credential's single var, or a Connections profile's own `env`);
  output is capped (10 MB → kill) and runs are bounded by a timeout
  with a force-kill of the process tree. (The tool-call path is dormant scaffolding
  today — no bundled adapter emits `tool_call_requested`; see #83. When it is wired,
  approval is decided server-side from the agent's `tool_permissions` and the tool name,
  never from agent-emitted fields. The destructive-command denylist on that path is a **UX speed
  bump, not a security boundary** — it substring-matches a free-form shell string and
  anything determined gets past it; do not count it as a control.)
- **Write-path boundary.** The browser never writes `agent_runs` or `messages`
  directly — every write goes Browser → Next.js route handler → local SQLite
  (`@agentroom/db`), and only the bridge claims and completes runs. Mutating API
  routes enforce an Origin/CSRF check; the expensive ones (messages, uploads,
  agents, credentials, connections, memory, reset) are also rate-limited.
- **Local and single-user by design.** There are no accounts and no row-level
  policies: the web server binds `127.0.0.1` only, and all state lives in
  `~/.agentroom` (`%APPDATA%\AgentRoom` on Windows) — SQLite + files. The API is
  unauthenticated **because** it is localhost-only — do not reverse-proxy it onto
  a network you don't trust.
- **The `npx agentroom` bootstrapper** downloads the tagged release source from
  GitHub over TLS and trusts its local cache (`~/.agentroom/app/` — on Windows
  `%USERPROFILE%\.agentroom\app\`, a source cache separate from the
  `%APPDATA%\AgentRoom` data folder) the same way npm trusts its own cache:
  anyone who can write those paths (or your shell env) already runs code as you.
  Release tags are the trust root and are protected against moves/deletion
  (ADR-0014).
- **Third-party data egress.** Optional image text/OCR extraction sends image bytes to
  OpenAI. It is **off by default** (`ENABLE_IMAGE_TEXT_EXTRACTION=false`) and must be
  explicitly enabled with an API key.
- **Logs.** Logs are structured and **secret/PII-redacted**; opt-in error tracking
  redacts before any transport. The bridge `/healthz` + `/metrics` endpoints are
  **unauthenticated** — bind them to localhost / an internal network only.

## Hardening status

AgentRoom went through a multi-phase, security-focused pre-1.0 hardening effort with
adversarial review.

**What CI actually does — reporting vs. blocking.** `pnpm audit --audit-level high`,
`gitleaks` (secret scan, full history), and CodeQL all run on every pull request, on
pushes to `main`, and weekly ([`security.yml`](.github/workflows/security.yml)). None of
them is `continue-on-error`, so a finding fails its own job — but a failed job **does not
block a merge**: this repository has no required status checks configured, so on a PR
these three are **reporting only**, and a red check is a signal a human has to act on, not
a gate. There is nothing that mechanically stops a PR with a red security check from being
merged.

**On a release, two of them do block.** Pushing a `v*.*.*` tag runs
[`release.yml`](.github/workflows/release.yml), whose `verify` job re-runs
`pnpm audit --audit-level high` and `gitleaks` **on the tagged commit** — the GitHub
Release and the npm publish both depend on that job, so a tagged commit that trips either
one does not ship. CodeQL is **not** re-run on a tag and therefore blocks nothing at
release time. The `release` job additionally refuses to release a tag whose commit is not
an ancestor of `origin/main` (a `v*` tag can be created on any commit — tag *creation* is
not restricted server-side, only moves and deletions are), and every action in that
workflow is pinned to a full commit SHA rather than a movable tag.
