#!/usr/bin/env bash

# Do not let inherited xtrace settings expose OBSIDIAN_API_KEY.
set +x
set -Eeuo pipefail

readonly COMPONENT="obsidian-mcp-check"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=obsidian-common.sh
source "$SCRIPT_DIR/obsidian-common.sh"

readonly PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly MCP_NAME="${OBSIDIAN_MCP_NAME:-obsidian}"
readonly MCP_SCOPE="${OBSIDIAN_MCP_SCOPE:-user}"
readonly MCP_TIMEOUT_MS="${OBSIDIAN_MCP_TIMEOUT_MS:-5000}"

failures=0
incomplete=0

obsidian_resolve_endpoint "$COMPONENT" || exit 1

if [[ ! "$MCP_NAME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  obsidian_error "$COMPONENT" "Invalid OBSIDIAN_MCP_NAME."
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

obsidian_log "$COMPONENT" "Endpoint: $OBSIDIAN_MCP_URL"
if [[ -n "${OBSIDIAN_API_KEY:-}" ]]; then
  obsidian_log "$COMPONENT" "OBSIDIAN_API_KEY: set (value hidden)."
else
  obsidian_warn "$COMPONENT" "OBSIDIAN_API_KEY is not set."
  incomplete=1
fi

set +e
"$SCRIPT_DIR/obsidian-api-check.sh"
api_status=$?
set -e
case "$api_status" in
  0)
    ;;
  2)
    incomplete=1
    ;;
  *)
    failures=$((failures + 1))
    ;;
esac

if ! command -v claude >/dev/null 2>&1; then
  obsidian_error "$COMPONENT" "Claude Code CLI is not installed or not in PATH."
  failures=$((failures + 1))
else
  cd -- "$PROJECT_ROOT"
  claude_config=""
  if claude_config="$(MCP_TIMEOUT="$MCP_TIMEOUT_MS" claude mcp get "$MCP_NAME" </dev/null 2>&1)"; then
    if grep -Fq "$scope_marker" <<<"$claude_config" &&
      grep -Fq "URL: $OBSIDIAN_MCP_URL" <<<"$claude_config"; then
      obsidian_log "$COMPONENT" "OK: Claude Code targets the native MCP endpoint ($MCP_SCOPE scope)."
    else
      obsidian_error "$COMPONENT" "Claude Code endpoint or scope differs; run scripts/obsidian-mcp-configure.sh."
      failures=$((failures + 1))
    fi

    if grep -Fq 'Authorization: Bearer ${OBSIDIAN_API_KEY}' <<<"$claude_config"; then
      obsidian_log "$COMPONENT" "OK: Claude Code stores an environment placeholder for the API key."
    else
      obsidian_error "$COMPONENT" "Authorization does not use the safe OBSIDIAN_API_KEY placeholder; reconfigure it."
      failures=$((failures + 1))
    fi

    if grep -Eq 'Status:.*Connected' <<<"$claude_config"; then
      obsidian_log "$COMPONENT" "OK: Claude Code connected to the native MCP server."
    elif [[ -z "${OBSIDIAN_API_KEY:-}" ]]; then
      obsidian_warn "$COMPONENT" "MCP connection cannot succeed until OBSIDIAN_API_KEY is exported."
      incomplete=1
    else
      obsidian_error "$COMPONENT" "Claude Code did not connect to MCP. For HTTPS, trust the plugin certificate; otherwise enable loopback HTTP on port 27123."
      failures=$((failures + 1))
    fi
  else
    obsidian_error "$COMPONENT" "No readable Claude Code MCP config named $MCP_NAME; run scripts/obsidian-mcp-configure.sh."
    failures=$((failures + 1))
  fi
fi

if (( failures > 0 )); then
  obsidian_error "$COMPONENT" "Diagnostic failed with $failures error(s)."
  exit 1
fi
if (( incomplete > 0 )); then
  obsidian_warn "$COMPONENT" "Diagnostic is incomplete because required credentials are missing."
  exit 2
fi

obsidian_log "$COMPONENT" "OK: REST authentication and native MCP provisioning are operational."
