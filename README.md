# AgentRoom

[![CI](https://github.com/neric-joel/Whatsapp-Agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/neric-joel/Whatsapp-Agents/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/neric-joel/Whatsapp-Agents?sort=semver)](https://github.com/neric-joel/Whatsapp-Agents/releases/latest)

**A WhatsApp/Slack-style group chat where local LLM agents are named, visible participants.**

Create a room, add agents, send one message, and watch each agent reply in the same
conversation — or run **`/discuss`** to make them work as a _team_: a coordinator breaks the
problem into sub-tasks, assigns them by capability, the agents build on each other's work, and
they converge on one answer **with attribution**.

![AgentRoom demo: a /discuss where a coordinator assigns sub-tasks by capability, two agents execute and cross-review on a shared blackboard, and the team converges on one attributed answer, then a switch to a dark theme.](docs/demo/agentroom-demo.gif)

## What it is

Most "multi-agent" tools either hide the agents behind one answer or run them in isolation.
AgentRoom puts several **named CLI agents** (Claude Code, Codex, or a built-in mock) into one
group chat as first-class participants and gives them a real **collaboration protocol**. It runs
entirely on your machine against a local Supabase — no hosted service required, bring your own
agent CLIs (or none, using the mock).

It's a **pnpm monorepo**: a Next.js web app + API, a Supabase data layer (Postgres, Auth,
Realtime, Storage), and a separate TypeScript **bridge daemon** that runs the agent CLIs.

## Quickstart (local, ~5–10 min to a working app)

**Prerequisites:** [Node.js 22.13+](https://nodejs.org) · [pnpm 11+](https://pnpm.io)
(`corepack enable`) · [Docker Desktop](https://www.docker.com/products/docker-desktop/)
(for local Supabase) · [Supabase CLI](https://supabase.com/docs/guides/cli).
**No API keys are needed for this Quickstart** — you'll use the built-in **mock** agent. (The
`claude` / `codex` CLIs are optional and only needed to run _real_ agents.)

> **Windows shortcut:** `start-agentroom.bat` does all of the below automatically (starts
> Supabase, fills the env files from `supabase status`, launches both processes, opens the
> browser). On macOS/Linux/WSL, `make bootstrap` runs steps 1–3 (it copies the env templates but
> you still paste the keys in step 3, then run step 4).

```bash
# 1. Install dependencies
pnpm install

# 2. Start local Supabase (Docker) in its own terminal, then apply migrations + seed data
pnpm dev:supabase          # leave running; first run pulls Docker images (a few minutes)
pnpm db:reset              # applies migrations + seeds 3 demo agents (safe to re-run)

# 3. Create the two env files, then paste the keys that `supabase status` printed
cp apps/web/.env.example apps/web/.env.local   # Windows (no WSL/Git Bash): use `copy`
cp bridge/.env.example bridge/.env
supabase status            # prints API URL + the keys to copy
```

From `supabase status`, fill the env files (the other variables already have sane defaults):

| `supabase status` line | Goes into |
|---|---|
| `API URL` → `http://127.0.0.1:54321` | `NEXT_PUBLIC_SUPABASE_URL` (web) **and** `SUPABASE_URL` (bridge) |
| `publishable key` (`sb_publishable_…`) | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (web) |
| `secret key` / `service_role key` (`sb_secret_…`) | `SUPABASE_SERVICE_ROLE_KEY` (web **and** bridge) |

> Leave `CREDENTIAL_ENCRYPTION_KEY` **blank** — it's only for the bring-your-own-key feature, not
> the mock Quickstart. (Use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, not the old "anon key" name.)

```bash
# 4. Run the web app and the bridge daemon — each in its OWN terminal (both must stay running)
pnpm dev:web               # terminal A → http://localhost:3000
pnpm dev:bridge            # terminal B → claims agent_runs and produces replies
```

Then, in the browser:

1. Open **http://localhost:3000** and **sign up** (any email + password — local auth, no email
   confirmation).
2. Click **New Room**, create one, then open the room's **agents panel** (right side / room
   header) and **add an agent**. The seed ships three you can add — **Reviewer** (a **mock** that
   needs no API key — use this), plus **Claude Thinker** and **Codex Builder** (need the `claude`
   / `codex` CLIs installed and logged in) — or **＋ Create agent** to make your own.
3. **Send a message** — the agent replies as a participant. Add 2–3 agents and try
   **`/discuss <a problem>`** to see the team collaboration.

**Verify it's working:** `curl http://localhost:3000/api/health` returns `{"ok":true,…,"db":"up"}`,
and a message in a room containing the mock **Reviewer** gets a reply within a few seconds.

**Not getting a reply?** Check that (a) `pnpm dev:bridge` is running in its own terminal,
(b) both `.env` files have the keys from `supabase status`, (c) the agent is added to the room and
not muted. If a run is stuck, restart the bridge (stale runs auto-recover).

> Supabase Studio (browse the local DB) is at http://127.0.0.1:54323. Full env-var reference:
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#environment-variables).

## How it works

```text
Browser (chat UI)
  │  Supabase Auth + Realtime subscriptions
  ▼
Supabase ── Postgres (rooms, messages, agents, agent_runs, …) · Auth · Realtime · Storage
  │  a human message → Next.js API writes rows; `agent_runs` IS the work queue
  ▼
Bridge daemon  ── polls `agent_runs`, claims a run, builds a ContextPacketV1,
  │                invokes the right adapter, writes the reply back, marks the run done
  ▼
Agent CLIs  ── Claude Code · Codex CLI · mock  (spawned as sandboxed subprocesses)
```

The browser **never writes** to `agent_runs` or `messages` directly — all writes go through the
Next.js API (auth + RLS enforced). The bridge is the only thing that runs agent CLIs, in a
locked-down subprocess (no shell, static args, a stripped env, an output cap, process-tree kill).
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and trust boundaries.

## Features

- **Group chat** with named AI participants; one human message fans out to every active agent.
- **Real team collaboration — `/discuss`**: a coordinator decomposes the problem and assigns
  sub-tasks by capability; agents execute on a shared blackboard _seeing each other's work_,
  cross-review, and converge on one answer **with attribution** — with an anti-sycophancy
  _dissent_ stage so the team never rubber-stamps.
- **Adversarial `/debate`**: agents argue distinct assigned positions, then a coordinator
  adjudicates a winner (not a merge).
- **Bring-your-own CLI / API key**: per-user provider credentials, AES-256-GCM encrypted at
  rest, bound to agents (Settings → Providers).
- **Adapters:** Claude Code, Codex CLI, and a built-in mock (needs no external CLI).
- Mentions (`@agent_slug` / `@everyone`); agent-to-agent tag turns with loop guards.
- Per-room memory (`/remember`, `/recall`); message pinning; tool-approval for protected actions;
  run cancellation; Markdown + math (KaTeX) rendering; hallucination flagging on replies.
- **7 accessible themes** (light & dark families), WCAG 2.1 AA verified.

## Chat commands

Type these in any room's message box (`/help` shows the full, role-aware list):

| Command | What it does |
|---|---|
| `@agent_slug …` / `@everyone …` | Address one agent / all active agents |
| `/discuss <problem>` | Run a problem as a **team** (decompose → execute → cross-review → attributed answer) |
| `/debate <question>` | Adversarial: agents argue distinct positions; coordinator picks a winner |
| `/remember <note>` · `/recall <query>` | Save / retrieve per-room (or `--global`) memory |
| `/handoff @agent <task>` | Hand the thread to another agent |
| `/pin` · `/agents` · `/reset` (admin) | Pin a reply · list room agents · reset agent context |

## Bring your own provider key

Agents run on the credentials of the user who creates them ("the owner brings the fuel"). To use
your own key instead of the host CLI login:

1. Set the **same** `CREDENTIAL_ENCRYPTION_KEY` in both `apps/web/.env.local` and `bridge/.env`
   (`openssl rand -hex 32`). Without it the feature is disabled (the API returns `503`).
2. **Settings → Providers** → add a credential (provider, label, secret, optional base URL). The
   secret is **AES-256-GCM encrypted at rest** and never returned to the browser or logged.
3. Bind it to an agent. At spawn, the bridge decrypts the key and injects it into _that_
   adapter's child process only (e.g. `ANTHROPIC_API_KEY` for Claude, `OPENAI_API_KEY` +
   `OPENAI_BASE_URL` for Codex). Design + threat model: [`docs/adr/0010-byo-credentials.md`](docs/adr/0010-byo-credentials.md).

## Deploy / self-host

The default Docker image runs the **mock** adapter only; running real agent CLIs needs a host or
derived image that has them installed. See [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for the
local-Docker default, self-hosted Supabase, and the bridge trust model.

## Repository layout

```text
apps/web/        Next.js App Router app + API route handlers
bridge/          TypeScript bridge daemon + agent adapters
packages/shared/ Types + helpers shared by web and bridge (ContextPacketV1, discussion engine, …)
supabase/        Supabase config, migrations, seed, and pgTAP tests
scripts/         Local dev + stress-test scripts
docs/            ARCHITECTURE · SELF_HOSTING · OBSERVABILITY · adr/ (decision records)
```

## Documentation

- [`QUICKSTART.md`](QUICKSTART.md) — the short startup checklist.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data-flow, the `agent_runs` queue
  contract, the adapter/subprocess model, trust boundaries, and the full env-var reference.
- [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) — Docker, self-hosted Supabase, bridge trust model.
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) — logging, health/metrics, run state machine.
- [`docs/adr/`](docs/adr/) — architecture decision records (the "why").

## Common commands

```bash
pnpm typecheck            # type-check all workspaces
pnpm test                 # web + bridge + shared tests
pnpm lint                 # eslint
pnpm --filter web build   # production build of the web app
pnpm e2e                  # Playwright end-to-end tests
```

## Project status

Production-ready — **v1.1.0**. The MVP, a multi-phase security/quality hardening pass, the team
`/discuss` collaboration redesign, and bring-your-own-credentials have all shipped. Ongoing work:
broader provider support and polishing multi-agent output quality.

## Contributing · Security · License

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) (setup, quality gates,
trunk-based branch/commit/PR conventions) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). For
**security** issues, follow [`SECURITY.md`](SECURITY.md) — please don't open a public issue.
Changes are tracked in [`CHANGELOG.md`](CHANGELOG.md). Licensed under [MIT](LICENSE).
