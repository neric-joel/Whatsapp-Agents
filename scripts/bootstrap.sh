#!/usr/bin/env bash
# AgentRoom — one-command bootstrap (macOS / Linux / WSL).
# Windows users: use start-agentroom.bat / the desktop shortcut instead.
#
#   bash scripts/bootstrap.sh              # full setup
#   bash scripts/bootstrap.sh --check-only # prereq checks only
#
# AgentRoom is a local, single-user app: no Docker, no Supabase, no login. All it
# needs is Node + pnpm. State lives on disk under ~/.agentroom (or %APPDATA%\AgentRoom).
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

if [ "$CHECK_ONLY" -eq 1 ]; then
  bold "All prerequisites present."
  exit 0
fi

# ── install ────────────────────────────────────────────────────────────────────
bold "Installing dependencies (pnpm install)..."
pnpm install

bold "Done. Next steps:"
echo "  pnpm dev          # run web + bridge"
echo "  open http://localhost:3000"
echo "  Then open Connections to detect/add your agent CLIs (see docs/CONNECTING_CLIS.md)."
