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
- affected component (web / bridge / migrations / CI) and version/commit.

We aim to acknowledge within **7 days** and to agree on a disclosure timeline with you.
Please give us a reasonable window to ship a fix before any public disclosure. There
is no paid bug-bounty program; we credit reporters in the release notes unless you
prefer to remain anonymous.

## Supported versions

This is pre-1.0 software. Security fixes target the `main` branch (and the latest
tagged release once `v1.0.0` ships). Older commits are not maintained.

## Trust model (read this before you deploy)

- **The bridge executes CLIs on its host.** Real agent adapters (`claude-code`,
  `codex-cli`, `ruflo`, `myclaude`) spawn host-installed binaries as child processes.
  Anyone who can create an agent + send a message in a room the bridge serves can
  cause those CLIs to run. **Run the bridge only where you trust the room
  participants and the installed CLIs.** The default Docker bridge image ships the
  **mock adapter only** — no real CLIs — precisely to keep the default safe. See
  [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full boundary.
- **Subprocess hardening** (Phase 1): commands are spawned with `shell: false` and an
  argv array (no shell string, no command interpolation); agent-controlled
  `system_prompt` is delivered via **stdin**, never argv; binaries are resolved from
  an allowlisted `*_BIN` path; the child environment is minimized (the Supabase
  service-role key and other secrets are **never** forwarded to children); output is
  capped (10 MB → kill) and runs are bounded by a timeout with a force-kill of the
  process tree. A denylist blocks obviously destructive tool commands.
- **Service-role key boundary.** `SUPABASE_SERVICE_ROLE_KEY` is **server-only** — it
  must never reach the browser bundle. The browser uses the publishable (anon) key +
  RLS; it **cannot** write `agent_runs` or `messages` directly. Inject the
  service-role key at runtime; never bake it into an image or commit it.
- **Database / RLS.** Row-Level Security enforces room membership/ownership on every
  table, including storage objects (scoped to room membership). Mutating API routes
  require auth + an Origin/CSRF check and are rate-limited.
- **Third-party data egress.** Optional image text/OCR extraction sends image bytes to
  OpenAI. It is **off by default** (`ENABLE_IMAGE_TEXT_EXTRACTION=false`) and must be
  explicitly enabled with an API key.
- **Logs.** Logs are structured and **secret/PII-redacted**; opt-in error tracking
  redacts before any transport. The bridge `/healthz` + `/metrics` endpoints are
  **unauthenticated** — bind them to localhost / an internal network only.

## Hardening status

The repository tracks a multi-phase production-hardening effort
(`docs/production-hardening/`). Phase 1 (security) findings and fixes are documented
in `docs/reviews/`. `pnpm audit`, `gitleaks` (secret scan), and CodeQL run in CI.
