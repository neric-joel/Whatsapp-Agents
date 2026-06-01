# AgentRoom Quickstart

## Prerequisites

- Node.js 22.13+ (see `.nvmrc`)
- pnpm 11+ (`npm install -g pnpm@11.0.8` or `corepack enable`)
- Docker Desktop
- Supabase CLI
- Claude CLI
- Codex CLI

> **macOS / Linux / WSL:** `make bootstrap` does this entire local setup in one
> command. Running in containers or self-hosting? See
> [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md).

## First-Time Setup

1. Clone the repository.
2. Run `pnpm install`.
3. Copy the `.env.example` files to their local env file names.
4. Run `supabase start`.
5. Fill the `.env` files with the printed Supabase keys.
6. Run `supabase db reset`.

## Create Desktop Shortcut

```powershell
powershell -ExecutionPolicy Bypass -File create-desktop-shortcut.ps1
```

## Daily Use

Double-click AgentRoom on Desktop. Docker starts, Supabase starts, web and bridge launch, and the browser opens automatically.

## How It Works

User sends message -> Next.js creates `agent_runs` rows with `status=queued` -> bridge daemon polls -> spawns Claude/Codex CLI -> agent replies stream back -> Supabase Realtime pushes to browser.
