#!/usr/bin/env bash
set -euo pipefail

ROOT="${SECOND_BRAIN_TEST_ROOT:-$(mktemp -d /tmp/second-brain-empty.XXXXXX)}"
VAULT="$ROOT/vault"
PORT="${PORT:-3102}"

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  fi
}

CAPTURE_TOKEN="${CAPTURE_TOKEN:-$(rand_hex)}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-setup-test}"
MEMO_TOKEN="${MEMO_TOKEN:-$(rand_hex)}"
NEXT_PUBLIC_MCP_BASE_URL="${NEXT_PUBLIC_MCP_BASE_URL:-http://localhost:$PORT}"

SECOND_BRAIN_VAULT="$VAULT" npm run seed

cat <<EOF

Isolated first-run dashboard
  URL:                 http://localhost:$PORT/setup
  Vault:               $VAULT
  Dashboard password:  $DASHBOARD_PASSWORD

This does not use your real vault. Delete $ROOT to remove the test data.

EOF

exec env \
  PORT="$PORT" \
  SECOND_BRAIN_VAULT="$VAULT" \
  CAPTURE_TOKEN="$CAPTURE_TOKEN" \
  DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
  MEMO_TOKEN="$MEMO_TOKEN" \
  NEXT_PUBLIC_MCP_BASE_URL="$NEXT_PUBLIC_MCP_BASE_URL" \
  npm run dev
