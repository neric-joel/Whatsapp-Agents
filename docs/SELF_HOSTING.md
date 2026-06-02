# Self-hosting AgentRoom

AgentRoom is fully self-hostable on free, open-source infrastructure. **No paid plan
is required anywhere** — the default path uses a local Supabase stack via the Supabase
CLI (Docker). A hosted Supabase free tier is an optional convenience, not a requirement
(see the appendix).

This guide covers three things:

1. **Local development** — the fastest way to run the whole app on your machine.
2. **Docker Compose** — building and running the production `web` + `bridge` images.
3. **Production** — pointing those images at a real or self-hosted Supabase.

It also documents the two things that most affect a deployment: the **Supabase URL
model** (browser vs. container) and the **bridge subprocess trust model**.

---

## Components

| Component | What it is | Needs a network port? |
|-----------|------------|------------------------|
| `web` (`apps/web`) | Next.js app + API route handlers | Yes — HTTP `3000` |
| `bridge` (`bridge/`) | Polling daemon: claims `agent_runs`, invokes agent CLIs, writes replies | No — it is a worker |
| Supabase | Postgres + Auth + Realtime + Storage (the data plane + queue) | Yes — API `54321`, DB `54322`, Studio `54323` |

The browser talks to Supabase **directly** (Auth + Realtime + Storage) and to `web`
for the write-path API. `web` and `bridge` both talk to Supabase server-side using the
**service-role key**. The browser never receives the service-role key.

---

## Prerequisites

- **Node.js ≥ 22.13** (`.nvmrc` pins `22.13.0`; required by pnpm 11). `nvm install 22`.
- **pnpm ≥ 11** — `npm install -g pnpm@11.0.8` (or `corepack enable`).
- **Docker** (Desktop or Engine) — for the local Supabase stack and the container images.
- **Supabase CLI** — https://supabase.com/docs/guides/cli (`brew install supabase/tap/supabase`, `scoop install supabase`).
- **(Optional) Agent CLIs** on the host that runs the bridge: `claude`, `codex` — only
  needed to run those real agents (see the trust model below).

---

## 1. Local development (default, ~15 min)

```bash
# macOS / Linux / WSL
make bootstrap          # prereq checks → env files → install → supabase start → db reset
pnpm dev                # runs web (:3000) + bridge together
# open http://localhost:3000/auth
```

`make bootstrap` runs `scripts/bootstrap.sh`, which is idempotent: it never overwrites
env values you have already set, and only fills blank/placeholder keys from
`supabase status`.

**Windows:** use `start-agentroom.bat` (or the desktop shortcut created by
`create-desktop-shortcut.ps1`). See the [README Quickstart](../README.md#quickstart-local-510-min-to-a-working-app).

Manual equivalent:

```bash
cp apps/web/.env.example apps/web/.env.local
cp bridge/.env.example   bridge/.env
pnpm install
supabase start                       # prints the API URL + keys
# paste the keys into the two env files (see "Required keys")
supabase db reset                    # apply migrations + seed
pnpm dev
```

---

## 2. Docker Compose (production images)

`docker-compose.yml` builds and runs the **`web`** and **`bridge`** images. Supabase is
**not** bundled (see §3 for where it comes from).

```bash
cp .env.docker.example .env          # fill in the values
docker compose up --build            # builds both images, starts web (:3000) + bridge
```

Build the images directly (the build context is the repo **root** — this is a pnpm
monorepo and both apps depend on the raw-TypeScript `@agentroom/shared`):

```bash
docker build -f apps/web/Dockerfile -t agentroom-web \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="<publishable-key>" .
docker build -f bridge/Dockerfile -t agentroom-bridge .
```

Both images are multi-stage and run as a **non-root** user. `web` uses Next.js
standalone output for a small runtime image; `bridge` runs TypeScript via `tsx`.

### The Supabase URL model (read this)

`NEXT_PUBLIC_SUPABASE_URL` is **inlined into the browser bundle at build time** (and it
seeds the CSP `connect-src`), so it must be the URL the **browser** can reach. The
server side (`web` route handlers/SSR and the `bridge`) connect from **inside the
container**, which may need a different address.

- **Production (a real/managed/self-hosted Supabase with a stable URL):** the browser
  and the containers use the **same** URL. Set `SERVER_SUPABASE_URL` to the **same**
  value as `NEXT_PUBLIC_SUPABASE_URL`. ✅ Simple. (Compose has no variable-valued
  default, so `SERVER_SUPABASE_URL` is always set explicitly.)
- **Local `supabase start` on the host + containerized app:** the browser uses
  `http://localhost:54321`, but the containers must reach the host via
  `http://host.docker.internal:54321`. Set:
  ```env
  NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
  SERVER_SUPABASE_URL=http://host.docker.internal:54321
  ```
  > On Linux, `host.docker.internal` is provided by the `extra_hosts: host-gateway`
  > entry already in `docker-compose.yml`. For purely local work, running
  > `pnpm dev` on the host (Mode 1) is simpler than containerizing the app against a
  > host Supabase.

---

## 3. Production: where Supabase comes from

Pick one — both are free/OSS:

### Option A — Self-hosted Supabase (fully self-hosted, no third party)

Run the official Supabase self-hosting stack (Postgres + Kong + GoTrue + Realtime +
Storage + Studio) via its Docker Compose: https://supabase.com/docs/guides/self-hosting/docker.

> **Port clash:** that stack also binds 54321/54322 by default. If a local
> `supabase start` (development) is already running, stop it first (`supabase stop`),
> remap the self-hosted stack's ports, or run it on a separate host/network.

Then apply this project's schema:

```bash
supabase db push                       # or: psql "$DB_URL" -f each migration in supabase/migrations
psql "$DB_URL" -f supabase/seed.sql    # optional seed (3 agents, 1 room)
```

Point `agentroom-web` + `agentroom-bridge` at that stack's external URL + keys.

### Option B — Hosted Supabase free tier (optional convenience)

Create a free project at supabase.com, run the migrations + seed against it, and use its
URL + keys. See the appendix for the free-tier pause caveat. **Not required** — Option A
is fully self-contained.

---

## Required keys

| Variable | Used by | What it is |
|----------|---------|------------|
| `NEXT_PUBLIC_SUPABASE_URL` | web (build + runtime), bridge | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web (browser + server) | **Publishable** (anon) key. **Never** the deprecated `*_ANON_KEY` name. |
| `SUPABASE_SERVICE_ROLE_KEY` | web (server), bridge | **Secret.** Full DB privileges. Server/bridge only — never sent to the browser. |
| `NEXT_PUBLIC_APP_URL` | web | Public URL the app is served from |
| `SUPABASE_URL` | bridge | Same Supabase API URL (bridge naming) |

> **Naming rule (locked):** the publishable key variable is
> `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Using the deprecated
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` is rejected at boot.

Both apps **validate their environment at boot** (zod) and **fail fast**, naming the
missing/invalid variable, so a misconfiguration crashes immediately with a clear message
rather than failing mysteriously later.

---

## Where the bridge runs — and the subprocess trust model

This is the most important security decision when self-hosting.

The bridge executes **real local CLI programs** (`claude`, `codex`) as child
processes to produce agent replies. It does so safely
(`shell: false`, an allow-listed child environment with secrets stripped, a binary-path
allowlist, an output cap, and process-tree kill on timeout/abort) — but the model has
direct consequences:

1. **The bridge holds the Supabase `service_role` key** (full database privileges) **and**
   can **execute those CLIs**. Co-locating both is a large blast radius. Run the bridge
   only on infrastructure you control; inject the service-role key at runtime (env /
   secret manager), never bake it into an image.

2. **The default `agentroom-bridge` image can run only the `mock` adapter.** The real
   agent CLIs are **not** installed in the image. To run real agents you must either:
   - **Run the bridge on a host** that already has the CLIs installed and authenticated
     (the simplest production model), **or**
   - **Build a derived image** that installs those CLIs and supplies their provider auth
     (e.g. `ANTHROPIC_*`, `OPENAI_*`, `CODEX_*` and the CLIs' own config/auth
     dirs). Treat that image as highly privileged.

3. **Provider auth is forwarded, not stored by AgentRoom.** The bridge passes through an
   allowlisted set of provider env vars to the child CLI; you supply them. The CLIs
   authenticate to their own providers.

### Optional data egress — image text extraction (off by default)

If `ENABLE_IMAGE_TEXT_EXTRACTION=true`, the bridge sends image bytes to the OpenAI API
(`OPENAI_API_KEY`, `OPENAI_VISION_MODEL`) to extract text for agent context. This is
**off by default** and is the only outbound egress beyond Supabase + the agent CLIs.
Leave it disabled unless you accept that egress.

---

## Stopping / data

- Local Supabase: `supabase stop` (data persists in Docker volumes) or
  `supabase stop --no-backup` to discard.
- Compose app: `docker compose down` (does not touch Supabase volumes).
- The bridge handles `SIGTERM` (e.g. `docker stop`) gracefully: it stops claiming new
  runs and exits; any in-flight run is recovered by stale-run recovery on the next start.

---

## Appendix — hosted free-tier caveat

Supabase's hosted **free tier pauses a project after ~1 week of inactivity**; the first
request after a pause is slow while it resumes, and prolonged inactivity can require
manual restoration. For an always-on self-host, prefer **Option A (self-hosted
Supabase)**. No paid plan is needed for any path described here.
