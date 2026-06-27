# Connecting your agent CLIs

AgentRoom is a local chat room for the agent CLIs you already have installed. This
page is the complete guide to connecting them: auto-detection, manual (bring-your-own)
registration, the `config.json` format, what AgentRoom does and does **not** do about
authentication, the health states you'll see, and how a connected CLI joins a room.

## The one rule: auth is the CLI's job

**AgentRoom never manages a CLI's login and never asks you for an API key.** A
connection only records two things: *where the binary is* and *how to invoke it*. When
an agent replies, AgentRoom runs that binary as a subprocess, and the binary uses
whatever credentials it already stored on your machine — your `claude login`, your
`codex` ChatGPT sign-in, an `ANTHROPIC_API_KEY` in your environment, etc.

That means:

- You do **not** paste Claude or Codex keys into AgentRoom.
- If a CLI works in your terminal, it works in AgentRoom.
- If a CLI isn't logged in, its reply fails with the CLI's own auth error (the run is
  marked **failed** with that message — never silently hung), and you fix it the normal
  way: run `claude login` / `codex login` in your terminal.

The only exception is the optional per-profile `env` (see below), for the rare custom
CLI that needs an extra variable you choose to provide.

## 1. Auto-detection

Open **Connections** (🔌 in the sidebar, or `/connections`). AgentRoom probes your
system `PATH` for known CLIs and runs each one's `--version` to confirm it works. You'll
see one row per known CLI:

| State | Badge | Meaning |
|---|---|---|
| **detected ✓** | green | The binary is on your `PATH` and `--version` ran cleanly. Click **Connect**. |
| **found, check needed** | amber | The binary exists but `--version` returned an error or timed out — the detail line says why. You can still connect it. |
| **not found ✗** | grey | Not on your `PATH`. Install it, or add it manually (below) with a full path. |

Each row also shows a short note on how that CLI authenticates — a reminder, not a
prompt. Known CLIs in the catalog today: **Claude Code**, **Codex**, **Gemini CLI**,
**Antigravity**.

Clicking **Connect** saves a profile using the detected path and that CLI's default
arguments.

## 2. Manual / bring-your-own CLI

Anything not in the catalog — a custom wrapper, a local model server, a CLI on a
non-standard path — can be added by hand under **Add your own CLI**:

- **Display name** — what you'll see in the room (e.g. `My Local Model`).
- **@mention handle** — the slug you'll use to address it (`mymodel`).
- **Binary path or command** — an absolute path (`/opt/tools/mycli`) or a bare command
  resolved against `PATH` (`mycli`).
- **Arguments** — space-separated flags passed to the binary (optional).
- **Output format** — how AgentRoom reads the CLI's stdout:
  - **Generic** — the CLI reads the prompt on **stdin** and prints its reply to
    **stdout**. The whole stdout becomes the reply. This is the default and works for
    most CLIs.
  - **Claude Code** — parses `claude --print --output-format json` output.
  - **Codex** — parses `codex exec --json` output.
- **Extra env** (optional, `KEY=value` per line) — usually leave blank. Only add a
  variable if your CLI specifically requires one.

## 3. The `config.json` format

Connections are stored at the app-data home — `%APPDATA%\AgentRoom\config.json` on
Windows, otherwise `~/.agentroom/config.json` (override the whole directory with
`AGENTROOM_HOME`). You can edit it by hand; AgentRoom reads it on every detection and on
every agent run.

```json
{
  "version": 1,
  "clis": [
    {
      "id": "b3f1…",
      "name": "Claude Code",
      "slug": "claude",
      "bin": "/usr/local/bin/claude",
      "args": ["--print", "--output-format", "json"],
      "kind": "claude-code",
      "enabled": true,
      "created_at": "2026-06-27T00:00:00.000Z",
      "updated_at": "2026-06-27T00:00:00.000Z"
    },
    {
      "id": "9a02…",
      "name": "Codex",
      "slug": "codex",
      "bin": "codex",
      "args": ["exec", "--json", "-"],
      "kind": "codex-cli",
      "enabled": true,
      "created_at": "…",
      "updated_at": "…"
    },
    {
      "id": "c7d4…",
      "name": "My Local Model",
      "slug": "mymodel",
      "bin": "/opt/tools/mycli",
      "args": ["chat", "--stdin"],
      "env": { "MYCLI_PROFILE": "fast" },
      "kind": "generic",
      "enabled": true,
      "created_at": "…",
      "updated_at": "…"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable id; the agent row references it. Generated for you on save. |
| `name` | yes | Display name. |
| `slug` | yes | Default @mention handle (lowercase, `a-z0-9_-`). |
| `bin` | yes | Absolute path or a bare command found on `PATH`. |
| `args` | no | Static argument list (default `[]`). |
| `env` | no | Extra env vars for this CLI only. Omit to defer entirely to the CLI's own config (recommended). |
| `kind` | no | `claude-code` \| `codex-cli` \| `generic` (default `generic`). |
| `enabled` | no | `false` turns the CLI off without removing it (default `true`). |

### Where per-CLI env lives — the policy

By default AgentRoom stores **no** secrets: a CLI's auth is deferred to that CLI's own
config (cleaner, fewer secrets on disk). The optional per-profile `env` exists only for
the rare CLI that genuinely requires an extra variable, and you opt into it explicitly.
When AgentRoom spawns a child it always strips its own secrets from the environment;
only the variables you put in a profile's `env` (plus the standard provider variables a
CLI reads itself) are forwarded.

## 4. Verify + health states

The Connections screen health-checks every saved profile (the same `--version` probe).
A profile shows **detected ✓** when its binary runs, **found, check needed** when the
binary exists but the probe errored, and **not found ✗** when the binary can't be
located. Detection deliberately checks only that the **binary runs** — it does not try
to detect whether you're *logged in*, because that is CLI-specific and unreliable. The
honest signal for auth is at first real use: an unauthenticated CLI's run fails with its
own error message.

## 5. Add a connected CLI to a room

1. Open a room and the **agents** panel (or type `/agents`).
2. Click **`+ Add agent`** and pick your CLI from **Connected CLI**. The name and handle
   pre-fill; add an optional role/system prompt.
3. Click **Add to room**. The CLI joins as a named participant.
4. `@mention` it (or `@everyone`), or run `/discuss` — the bridge spawns the CLI's binary
   with the room context, captures its output, and posts the reply.

Enable/disable or remove a connection any time from the Connections screen; a disabled
CLI's agents stop replying until you re-enable it.
