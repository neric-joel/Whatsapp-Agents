# AgentRoom

[![CI](https://github.com/neric-joel/Whatsapp-Agents/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/neric-joel/Whatsapp-Agents/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/neric-joel/Whatsapp-Agents?sort=semver)](https://github.com/neric-joel/Whatsapp-Agents/releases/latest)

**A local, single-user chat room that puts the agent CLIs you already have installed
(Claude Code, Codex, Gemini, or your own) into one conversation as named participants.**

Create a room, connect your CLIs, send one message, and watch each one reply in the same
conversation. They can `@mention` each other and, with **`/discuss`**, work as a _team_:
a coordinator splits the problem into sub-tasks, the agents build on each other's work on
a shared blackboard, and they converge on one answer **with attribution**.

![AgentRoom demo: a /discuss where a coordinator assigns sub-tasks by capability, two agents execute and cross-review on a shared blackboard, and the team converges on one attributed answer, then a switch to a dark theme.](docs/demo/agentroom-demo.gif)

## What it is

Most "multi-agent" tools hide the agents behind one answer, or make you wire up API keys
for a hosted service. AgentRoom does neither. It runs entirely on your machine, has no
accounts and no login, and brings in the CLIs you already use. It just runs those
binaries, which authenticate themselves the way they already do in your terminal, so you
never paste a Claude or Codex key into AgentRoom.

State lives in a single local folder (`~/.agentroom`, or `%APPDATA%\AgentRoom` on
Windows): a SQLite database, your uploaded files, and a `config.json` of connected CLIs.
Nothing leaves `localhost`.

It's a **pnpm monorepo**: a Next.js web app + API, a local SQLite data layer
(`@agentroom/db`), and a separate TypeScript **bridge daemon** that runs the agent CLIs.

## Quickstart (a couple of minutes to a working app)

**Prerequisites:** [Node.js 22.13+](https://nodejs.org) and [pnpm 11+](https://pnpm.io)
(`corepack enable`). That's it — no Docker, no database to install, no login. To run
*real* agents you'll want at least one CLI installed and logged in
([Claude Code](https://docs.claude.com/en/docs/claude-code),
[Codex](https://github.com/openai/codex), …); with none, you can still try everything
using the built-in **mock** agent.

```bash
# 1. Clone and enter the repo (every command runs from here)
git clone https://github.com/neric-joel/Whatsapp-Agents.git
cd Whatsapp-Agents

# 2. Start AgentRoom — one command, cross-platform
pnpm start
```

`pnpm start` installs dependencies on first run, builds the app, starts the web server and
the bridge daemon, waits until **http://localhost:3000** is ready, and opens it in your
browser. Press **Ctrl-C** to stop both. (On Windows you can double-click
**`start-agentroom.bat`**, which just runs `pnpm start`.)

On first run AgentRoom creates `~/.agentroom/` (the SQLite DB + a `files/` folder) and
seeds a starter room — you're straight in, no sign-up.

### Use it

1. **Connect your CLIs.** Click **🔌 Connect** in the sidebar (or go to `/connections`).
   AgentRoom probes your `PATH` and shows what it found —
   `Claude Code — detected ✓`, `Codex — detected ✓`, `Antigravity — not found ✗`. Click
   **Connect** on the ones you want. Not on the list? Add any binary by hand under **Add
   your own CLI**. See **[Connect your own CLI](#connect-your-own-cli)** below.
2. **Create a room** and open the **agents** panel.
3. **Add your agents.** Click **`+ Add agent`**, pick a connected CLI under **Connected
   CLI**, optionally give it a role, and add it. Add a **second** one too — you need at
   least two for a real conversation (and for `/discuss`).
4. **Send a message.** Type anything; each agent replies as its own participant within a
   few seconds — using its own login, no keys asked.
5. **Make them collaborate.** `@mention` one agent, or run **`/discuss <a problem>`** to
   have the team decompose it, build on a shared blackboard, cross-review, and converge
   on one attributed answer. `/help` lists every command.
6. **Attach files**, **pin** replies, switch among **7 light/dark themes** from the room
   header.

**Verify it's working:** `curl http://localhost:3000/api/health` returns
`{"ok":true,…,"db":"up"}`, and a message in a room with at least one connected, unmuted
agent gets a reply within a few seconds.

**Not getting a reply?** Check that (a) the bridge is running (`pnpm start` runs it; if it
stopped, run `pnpm start` again), (b) the room has at least one agent and it isn't muted,
and (c) the CLI is logged in — if a reply fails with an auth error, run that CLI's login in
your terminal (e.g. `claude login`). Stale runs auto-recover on restart.

## Connect your own CLI

AgentRoom only needs to know **where a CLI's binary is and how to invoke it** — auth is
always the CLI's own job, so you're never asked for an API key. Two ways in:

- **Auto-detect:** the Connections screen finds known CLIs on your `PATH` and reports
  whether each one runs. One click connects it.
- **Bring your own:** add any binary by display name, path, arguments, and output format.
  Point it at a custom wrapper, a local model server, anything that reads a prompt on
  stdin and prints a reply.

Connections are saved to `~/.agentroom/config.json`. The full guide — detection, the
`config.json` schema, the auth-is-the-CLI's-job rule, the health states, and the
add-to-room flow — is in **[docs/CONNECTING_CLIS.md](docs/CONNECTING_CLIS.md)**.

## How it works

```text
Local browser (chat UI)
  │  fetches the Next.js API; polls for new messages + run status
  ▼
Next.js API ── reads/writes local SQLite (@agentroom/db) + a local files/ folder
  │  a human message → API writes rows; `agent_runs` IS the work queue
  ▼
Bridge daemon  ── polls `agent_runs`, claims a run, builds a ContextPacketV1,
  │                spawns the right CLI, captures output, writes the reply, marks it done
  ▼
Your agent CLIs ── Claude Code · Codex · Gemini · any custom CLI · a built-in mock
                   (spawned as locked-down subprocesses)
```

Everything is local and single-user — there are no accounts and no network service. The
browser talks only to the Next.js API; the bridge is the only thing that runs agent CLIs,
in a locked-down subprocess (no shell, static args, a stripped environment, an output
cap, and a process-tree kill on timeout/cancel). See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and trust boundaries.

## Features

- **Group chat** with named CLI participants; one human message fans out to every active
  agent, each replying as itself.
- **Connect any CLI** — auto-detection + bring-your-own registration, with auth deferred
  entirely to each CLI ([docs/CONNECTING_CLIS.md](docs/CONNECTING_CLIS.md)).
- **Real team collaboration — `/discuss`**: a coordinator decomposes the problem and
  assigns sub-tasks by capability; agents execute on a shared blackboard _seeing each
  other's work_, cross-review, and converge on one answer **with attribution** — with an
  anti-sycophancy _dissent_ stage so the team never rubber-stamps.
- **Adversarial `/debate`**: agents argue distinct assigned positions; a coordinator
  adjudicates a winner.
- Mentions (`@agent_slug` / `@everyone`); agent-to-agent tag turns with loop guards.
- Local file attachments; per-room memory (`/remember`, `/recall`); message pinning;
  tool-approval for protected actions; run cancellation; Markdown + math (KaTeX);
  hallucination flagging on replies.
- **7 accessible themes** (light & dark families), WCAG 2.1 AA verified.

## Chat commands

Type these in any room's message box (`/help` shows the full list):

| Command | What it does |
|---|---|
| `@agent_slug …` / `@everyone …` | Address one agent / all active agents |
| `/discuss <problem>` | Run a problem as a **team** (decompose → execute → cross-review → attributed answer) |
| `/debate <question>` | Adversarial: agents argue distinct positions; coordinator picks a winner |
| `/remember <note>` · `/recall <query>` | Save / retrieve per-room (or `--global`) memory |
| `/handoff @agent <task>` | Hand the thread to another agent |
| `/pin` · `/agents` · `/reset` | Pin a reply · list room agents · reset agent context |

## Repository layout

```text
apps/web/         Next.js App Router app + API route handlers
bridge/           TypeScript bridge daemon + agent adapters (incl. the CLI-profile adapter)
packages/db/      Local SQLite data layer: schema, queue, app-data paths, config.json, CLI detection
packages/shared/  Types + helpers shared by web and bridge (ContextPacketV1, discussion engine, …)
scripts/          Local dev helpers
docs/             CONNECTING_CLIS · ARCHITECTURE · OBSERVABILITY · adr/ (decision records)
```

## Documentation

- [`docs/CONNECTING_CLIS.md`](docs/CONNECTING_CLIS.md) — connect, detect, and bring your
  own CLI; the `config.json` format; the auth model.
- [`docs/WORKSPACE_MODEL.md`](docs/WORKSPACE_MODEL.md) — Cowork-style working folders +
  sessions, mapped to AgentRoom.
- [`docs/CANARY_LOOKAHEAD.md`](docs/CANARY_LOOKAHEAD.md) — the hallucination lookahead gate
  that stops a wrong claim from spreading between agents.
- [`docs/MEMORY_AND_INTERACTION.md`](docs/MEMORY_AND_INTERACTION.md) — memory, context
  windowing, turn-taking, and loop guards.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, data-flow, the `agent_runs`
  queue contract, the adapter/subprocess model, trust boundaries.
- [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) — logging, health/metrics, run state machine.
- [`docs/adr/`](docs/adr/) — architecture decision records (the "why").

## Common commands

```bash
# Run it (end users)
pnpm start                # build + start web + bridge, then open the browser
pnpm build                # just build the web app

# Develop it (contributors — hot reload, no build step)
pnpm dev                  # run web + bridge together in watch mode
pnpm typecheck            # type-check all workspaces
pnpm test                 # web + bridge + db tests
pnpm lint                 # eslint
pnpm e2e                  # Playwright end-to-end tests
```

> **Users run `pnpm start`** (the built production app). **Contributors run `pnpm dev`**
> for hot reload. `pnpm dev` is for development only — it's not what you ship to people.

## Contributing · Security · License

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) (setup, quality gates,
branch/commit/PR conventions) and [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). For
**security** issues, follow [`SECURITY.md`](SECURITY.md) — please don't open a public
issue. Licensed under [MIT](LICENSE).
