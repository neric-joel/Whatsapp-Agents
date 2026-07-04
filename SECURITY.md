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
  you trust, and only connect CLIs you trust.** With no real CLI connected, the
  built-in **mock adapter** is the only thing that runs. See
  [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full boundary.
- **Subprocess hardening**: commands are spawned with `shell: false` and an
  argv array (no shell string, no command interpolation); agent-controlled
  `system_prompt` is delivered via **stdin**, never argv; binaries are resolved from
  an allowlisted path; the child environment is reduced to an allowlist, and anything
  matching the secret denylist (tokens, keys, `SUPABASE_*`/`SERVICE_ROLE` leftovers)
  is **never** forwarded to children; output is capped (10 MB → kill) and runs are
  bounded by a timeout with a force-kill of the process tree. A denylist blocks
  obviously destructive tool commands.
- **Write-path boundary.** The browser never writes `agent_runs` or `messages`
  directly — every write goes Browser → Next.js route handler → local SQLite
  (`@agentroom/db`), and only the bridge claims and completes runs. Mutating API
  routes enforce an Origin/CSRF check and are rate-limited.
- **Local and single-user by design.** There are no accounts and no row-level
  policies: the web server binds `127.0.0.1` only, and all state lives in
  `~/.agentroom` (SQLite + files). The API is unauthenticated **because** it is
  localhost-only — do not reverse-proxy it onto a network you don't trust.
- **Third-party data egress.** Optional image text/OCR extraction sends image bytes to
  OpenAI. It is **off by default** (`ENABLE_IMAGE_TEXT_EXTRACTION=false`) and must be
  explicitly enabled with an API key.
- **Logs.** Logs are structured and **secret/PII-redacted**; opt-in error tracking
  redacts before any transport. The bridge `/healthz` + `/metrics` endpoints are
  **unauthenticated** — bind them to localhost / an internal network only.

## Hardening status

AgentRoom went through a multi-phase, security-focused pre-1.0 hardening effort with
adversarial review. `pnpm audit`, `gitleaks` (secret scan), and CodeQL run in CI on every PR.
