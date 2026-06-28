# Running AgentRoom

> **History note.** Earlier versions of AgentRoom were a hosted Supabase + Docker
> deployment, and this file documented self-hosting that stack. AgentRoom is now a
> **local, single-user desktop app** — there is nothing to host. It runs on `localhost`
> against a local SQLite database and a files folder under `~/.agentroom`: no Supabase,
> no Docker, no accounts, no required keys. The Docker/Supabase instructions that used to
> be here no longer apply and have been removed.

This page covers how to run it and the one security decision that matters when you do
(the **bridge subprocess trust model**). For the architecture see
[ARCHITECTURE.md](ARCHITECTURE.md); for connecting CLIs see
[CONNECTING_CLIS.md](CONNECTING_CLIS.md).

---

## Components

| Component | What it is | Needs a network port? |
|-----------|------------|------------------------|
| `web` (`apps/web`) | Next.js app + API route handlers | Yes — HTTP `3000` (localhost) |
| `bridge` (`bridge/`) | Polling daemon: claims `agent_runs`, invokes agent CLIs, writes replies | No — it is a worker |
| local data (`@agentroom/db`) | SQLite DB + uploaded files + `config.json`, under `~/.agentroom` | No — on-disk only |

The browser talks only to `web`. Both `web` and `bridge` read/write the same local
SQLite database and files folder. Nothing leaves `localhost`.

---

## Prerequisites

- **Node.js ≥ 22.13** (`.nvmrc` pins `22.13.0`; required by pnpm 11). `nvm install 22`.
- **pnpm ≥ 11** — `npm install -g pnpm@11.0.8` (or `corepack enable`).
- **(Optional) Agent CLIs** on the host that runs the bridge: `claude`, `codex`, or any
  bring-your-own CLI — only needed to run those real agents (see the trust model below).
  Without any, the built-in **mock** adapter works end-to-end.

There is **no Docker, no database to install, and no accounts.**

---

## 1. Run it

End users run the built app; contributors run watch mode.

```bash
git clone https://github.com/neric-joel/Whatsapp-Agents.git
cd Whatsapp-Agents
pnpm start              # install (first run) + build + run web (:3000) + bridge, then open the browser
```

`pnpm start` waits until **http://localhost:3000** is ready and opens it. Press
**Ctrl-C** to stop both. On Windows you can double-click **`start-agentroom.bat`**, a thin
wrapper around `pnpm start`. See the
[README Quickstart](../README.md#quickstart-a-couple-of-minutes-to-a-working-app).

Contributors (hot reload, no build step):

```bash
pnpm install
pnpm dev                # runs web (:3000) + bridge together in watch mode
```

`make bootstrap` (macOS / Linux / WSL) is a convenience wrapper around
`scripts/bootstrap.sh`: it checks prerequisites (Node + pnpm versions) and runs
`pnpm install`. It does **not** set up any services — there are none. Use
`bash scripts/bootstrap.sh --check-only` to run just the prerequisite checks.

On first run AgentRoom creates `~/.agentroom/` (or `%APPDATA%\AgentRoom` on Windows) with
the SQLite DB + a `files/` folder + a `config.json`, and seeds a starter room. No env
files are needed; the two `.env.example` files only document optional overrides
(see [ARCHITECTURE.md → Environment variables](ARCHITECTURE.md#environment-variables)).

---

## 2. Where the bridge runs — and the subprocess trust model

This is the most important security decision.

The bridge executes **real local CLI programs** (`claude`, `codex`, any CLI you add) as
child processes to produce agent replies. It does so with `shell: false`, a static argv
array (agent input never reaches argv), an allow-listed child environment with secrets
stripped, a binary-path allowlist, an output cap, and a process-tree kill on
timeout/abort — but the model still has direct consequences:

1. **The bridge can execute those CLIs with whatever they can reach.** Run the bridge
   only on a machine whose participants you trust. See [SECURITY.md](../SECURITY.md) for
   the "run only where you trust the participants" rule.

2. **Provider auth is the CLI's own job — AgentRoom never stores it.** The bridge passes
   through an allowlisted set of provider env vars (`ANTHROPIC_*`, `OPENAI_*`, `CODEX_*`,
   …) to the child CLI; the CLIs authenticate to their own providers exactly as they do
   in your terminal. You are never asked to paste a provider API key into AgentRoom.
   (The optional BYO-credentials feature is the one exception — see
   `CREDENTIAL_ENCRYPTION_KEY` in [ARCHITECTURE.md](ARCHITECTURE.md#environment-variables)
   and [ADR-0010](adr/0010-byo-credentials.md).)

### Optional data egress — image text extraction (off by default)

If `ENABLE_IMAGE_TEXT_EXTRACTION=true`, the bridge sends image bytes to the OpenAI API
(`OPENAI_API_KEY`, `OPENAI_VISION_MODEL`) to extract text for agent context. This is
**off by default** and is the only outbound egress beyond the agent CLIs themselves.
Leave it disabled unless you accept that egress.

---

## Stopping / data

- Press **Ctrl-C** to stop `pnpm start` / `pnpm dev` (both `web` and `bridge`).
- The bridge handles `SIGTERM` gracefully: it stops claiming new runs and exits; any
  in-flight run is recovered by stale-run recovery on the next start.
- Your data lives under `~/.agentroom` (or `%APPDATA%\AgentRoom`). Delete that folder to
  start fresh; back it up to keep your rooms, messages, files, and connected-CLI config.
