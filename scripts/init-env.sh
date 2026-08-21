#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "${1:-32}"
  else
    node -e "console.log(require('crypto').randomBytes(${1:-32}).toString('hex'))"
  fi
}

env_value() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE"
}

set_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" key "=" { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

needs_value() {
  local value="$1"
  [ -z "$value" ] || [ "$value" = "replace-with-random-token" ]
}

ensure_env() {
  local key="$1"
  local fallback="$2"
  local current
  current="$(env_value "$key")"
  if needs_value "$current"; then
    set_env "$key" "$fallback"
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
fi

dashboard_password="$(env_value DASHBOARD_PASSWORD)"
[ -n "$dashboard_password" ] || dashboard_password="brain-$(rand_hex 6)"

ensure_env SECOND_BRAIN_VAULT "./vault"
ensure_env CAPTURE_TOKEN "$(rand_hex 32)"
ensure_env DASHBOARD_PASSWORD "$dashboard_password"
ensure_env SESSION_SECRET "$(rand_hex 32)"
ensure_env NEXT_PUBLIC_MCP_BASE_URL "${NEXT_PUBLIC_MCP_BASE_URL:-http://localhost:${PORT:-3000}}"
ensure_env MEMO_BRIDGE_URL "${MEMO_BRIDGE_URL:-http://127.0.0.1:8089}"
# Older generated files used Docker's host alias directly. Keep .env suitable
# for both local development and Compose; docker-compose.yml now applies its
# own container-only override.
if [ -z "${MEMO_BRIDGE_URL:-}" ] && [ "$(env_value MEMO_BRIDGE_URL)" = "http://host.docker.internal:8089" ]; then
  set_env MEMO_BRIDGE_URL "http://127.0.0.1:8089"
fi
ensure_env MEMO_TOKEN "$(rand_hex 32)"

cat <<EOF

Second Brain is initialized.
  Dashboard password: $dashboard_password
  Vault: $(env_value SECOND_BRAIN_VAULT)

Next:
  docker compose up -d --build
  open http://localhost:${PORT:-3000}/setup

AI bridge: isolated in Docker
  docker compose ps ai-bridge

EOF
