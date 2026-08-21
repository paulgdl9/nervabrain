#!/usr/bin/env bash

# Do not let inherited xtrace settings expose OBSIDIAN_API_KEY.
set +x
set -Eeuo pipefail

readonly COMPONENT="obsidian-mcp-configure"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=obsidian-common.sh
source "$SCRIPT_DIR/obsidian-common.sh"

readonly PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly MCP_NAME="${OBSIDIAN_MCP_NAME:-obsidian}"
readonly MCP_SCOPE="${OBSIDIAN_MCP_SCOPE:-user}"
readonly MCP_TIMEOUT_MS="${OBSIDIAN_MCP_TIMEOUT_MS:-5000}"
readonly HEADER_TEMPLATE='Authorization: Bearer ${OBSIDIAN_API_KEY}'

obsidian_resolve_endpoint "$COMPONENT" || exit 1

if [[ ! "$MCP_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  obsidian_error "$COMPONENT" "OBSIDIAN_MCP_NAME may contain only letters, digits, dots, underscores, and hyphens."
  exit 1
fi
case "$MCP_SCOPE" in
  local)
    scope_marker="Scope: Local config"
    ;;
  project)
    scope_marker="Scope: Project config"
    ;;
  user)
    scope_marker="Scope: User config"
    ;;
  *)
    obsidian_error "$COMPONENT" "OBSIDIAN_MCP_SCOPE must be local, project, or user."
    exit 1
    ;;
esac
if [[ ! "$MCP_TIMEOUT_MS" =~ ^[1-9][0-9]*$ ]]; then
  obsidian_error "$COMPONENT" "OBSIDIAN_MCP_TIMEOUT_MS must be a positive integer."
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  obsidian_error "$COMPONENT" "Claude Code CLI is required."
  exit 1
fi

cd -- "$PROJECT_ROOT"

existing_config=""
if existing_config="$(MCP_TIMEOUT="$MCP_TIMEOUT_MS" claude mcp get "$MCP_NAME" </dev/null 2>&1)"; then
  if grep -Fq "$scope_marker" <<<"$existing_config" &&
    grep -Fq "URL: $OBSIDIAN_MCP_URL" <<<"$existing_config" &&
    grep -Fq 'Authorization: Bearer ${OBSIDIAN_API_KEY}' <<<"$existing_config"; then
    obsidian_log "$COMPONENT" "OK: $MCP_NAME is already configured at $OBSIDIAN_MCP_URL ($MCP_SCOPE scope)."
    if [[ -z "${OBSIDIAN_API_KEY:-}" ]]; then
      obsidian_warn "$COMPONENT" "OBSIDIAN_API_KEY is not set; export it before starting Claude Code."
      exit 2
    fi
    exit 0
  fi
fi

# Remove only the requested scope. Output is discarded because an old config
# could contain a literal secret that must never be echoed by this script.
claude mcp remove "$MCP_NAME" --scope "$MCP_SCOPE" </dev/null >/dev/null 2>&1 || true

if ! claude mcp add \
  --transport http \
  --scope "$MCP_SCOPE" \
  "$MCP_NAME" \
  "$OBSIDIAN_MCP_URL" \
  --header "$HEADER_TEMPLATE" \
  </dev/null; then
  obsidian_error "$COMPONENT" "Claude Code could not configure the native Obsidian MCP server."
  exit 1
fi

obsidian_log "$COMPONENT" "OK: configured native Streamable HTTP MCP at $OBSIDIAN_MCP_URL ($MCP_SCOPE scope)."
obsidian_log "$COMPONENT" 'The Claude configuration contains ${OBSIDIAN_API_KEY}, not the secret value.'

if [[ -z "${OBSIDIAN_API_KEY:-}" ]]; then
  obsidian_warn "$COMPONENT" "OBSIDIAN_API_KEY is not set; export it before starting Claude Code."
  exit 2
fi
