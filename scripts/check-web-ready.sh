#!/usr/bin/env bash
# AgentRoom — POSIX web readiness probe (twin of scripts/check-web-ready.ps1).
# Contract: GET /api/health -> 200, POST /api/rooms -> 401 (auth enforced),
# GET /auth -> 200. Exits non-zero if any check fails.
#
#   bash scripts/check-web-ready.sh [BASE_URL]   # default http://localhost:3000
set -euo pipefail

BASE="${1:-http://localhost:3000}"
fail=0

check() { # METHOD PATH EXPECTED
  local method="$1" path="$2" want="$3" code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path" || echo 000)"
  if [ "$code" = "$want" ]; then
    printf '  \033[32m✓\033[0m %-4s %-12s -> %s\n' "$method" "$path" "$code"
  else
    printf '  \033[31m✗ %-4s %-12s -> %s (expected %s)\033[0m\n' "$method" "$path" "$code" "$want"
    fail=1
  fi
}

echo "Probing $BASE ..."
check GET  /api/health 200
check POST /api/rooms  401
check GET  /auth       200

if [ "$fail" -ne 0 ]; then
  echo "web is NOT ready" >&2
  exit 1
fi
echo "web is ready"
