#!/usr/bin/env bash
# AgentRoom — cross-platform one-command bootstrap (macOS / Linux / WSL).
# Windows users: use start-agentroom.bat / the desktop shortcut instead.
#
#   bash scripts/bootstrap.sh              # full setup
#   bash scripts/bootstrap.sh --check-only # prereq checks only (make doctor)
#
# Idempotent: never overwrites env files that already hold real values; only fills
# blank/placeholder keys from `supabase status`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MIN_NODE="22.13.0"
CHECK_ONLY=0
[ "${1:-}" = "--check-only" ] && CHECK_ONLY=1

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# ── prerequisite checks ───────────────────────────────────────────────────────
bold "Checking prerequisites..."

if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node -v | sed 's/^v//')"
  if [ "$(printf '%s\n%s\n' "$MIN_NODE" "$NODE_VER" | sort -V | head -n1)" = "$MIN_NODE" ]; then
    ok "node $NODE_VER (>= $MIN_NODE)"
  else
    die "node $NODE_VER is too old; need >= $MIN_NODE (see .nvmrc). Install: https://nodejs.org or 'nvm install 22'"
  fi
else
  die "node not found; install Node >= $MIN_NODE (https://nodejs.org or 'nvm install 22')"
fi

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm $(pnpm -v)"
else
  die "pnpm not found; install with: npm install -g pnpm@11.0.8  (or: corepack enable)"
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) (daemon running)"
  else
    die "docker is installed but the daemon is not running — start Docker Desktop / the docker service"
  fi
else
  die "docker not found; install Docker Desktop (https://docs.docker.com/get-docker/)"
fi

if command -v supabase >/dev/null 2>&1; then
  ok "supabase CLI $(supabase --version 2>/dev/null | head -n1)"
else
  die "supabase CLI not found; install: https://supabase.com/docs/guides/cli (brew install supabase/tap/supabase | scoop install supabase | npm? not supported)"
fi

if [ "$CHECK_ONLY" -eq 1 ]; then
  bold "All prerequisites present."
  exit 0
fi

# ── env files (create from examples; never clobber real values) ────────────────
bold "Preparing env files..."
[ -f apps/web/.env.local ] || { cp apps/web/.env.example apps/web/.env.local; ok "created apps/web/.env.local"; }
[ -f bridge/.env ] || { cp bridge/.env.example bridge/.env; ok "created bridge/.env"; }

# ── install ────────────────────────────────────────────────────────────────────
bold "Installing dependencies (pnpm install)..."
pnpm install

# ── supabase ────────────────────────────────────────────────────────────────────
bold "Starting local Supabase (idempotent)..."
supabase start >/dev/null 2>&1 || supabase start || die "supabase start failed"
ok "Supabase running (API http://127.0.0.1:54321, Studio http://127.0.0.1:54323)"

# Pull keys in env format and fill blanks only.
STATUS_ENV="$(supabase status -o env 2>/dev/null || true)"
get() { printf '%s\n' "$STATUS_ENV" | sed -n "s/^$1=//p" | tr -d '"' | head -n1; }
ANON_KEY="$(get ANON_KEY)"; [ -z "$ANON_KEY" ] && ANON_KEY="$(get PUBLISHABLE_KEY)"
SERVICE_KEY="$(get SERVICE_ROLE_KEY)"; [ -z "$SERVICE_KEY" ] && SERVICE_KEY="$(get SECRET_KEY)"
API_URL="http://127.0.0.1:54321"

# fill FILE KEY VALUE — set KEY=VALUE only if the current value is blank/placeholder.
fill() {
  local file="$1" key="$2" val="$3"
  [ -z "$val" ] && return 0
  local cur; cur="$(sed -n "s/^$key=//p" "$file" | head -n1 || true)"
  case "$cur" in
    ''|your-*|'<'*|changeme*|replace*) : ;;
    *) return 0 ;;  # already has a real value — leave it
  esac
  if grep -q "^$key=" "$file"; then
    # portable in-place edit (BSD + GNU sed)
    sed "s|^$key=.*|$key=$val|" "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}

bold "Filling local Supabase keys into env files..."
fill apps/web/.env.local NEXT_PUBLIC_SUPABASE_URL "$API_URL"
fill apps/web/.env.local NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$ANON_KEY"
fill apps/web/.env.local SUPABASE_SERVICE_ROLE_KEY "$SERVICE_KEY"
fill bridge/.env SUPABASE_URL "$API_URL"
fill bridge/.env SUPABASE_SERVICE_ROLE_KEY "$SERVICE_KEY"
ok "env files filled (existing real values left untouched)"

# ── migrations + seed ────────────────────────────────────────────────────────
bold "Applying migrations + seed (supabase db reset)..."
supabase db reset

bold "Done. Next steps:"
echo "  pnpm dev          # run web + bridge"
echo "  open http://localhost:3000/auth"
echo "  Supabase Studio:  http://127.0.0.1:54323"
