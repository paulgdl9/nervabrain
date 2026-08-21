#!/usr/bin/env bash

# Do not let inherited xtrace settings expose OBSIDIAN_API_KEY.
set +x
set -Eeuo pipefail

readonly COMPONENT="obsidian-api"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=obsidian-common.sh
source "$SCRIPT_DIR/obsidian-common.sh"

readonly CONNECT_TIMEOUT="${OBSIDIAN_CONNECT_TIMEOUT_SECONDS:-3}"
readonly REQUEST_TIMEOUT="${OBSIDIAN_REQUEST_TIMEOUT_SECONDS:-10}"

obsidian_validate_timeout "$COMPONENT" "$CONNECT_TIMEOUT" "OBSIDIAN_CONNECT_TIMEOUT_SECONDS" || exit 1
obsidian_validate_timeout "$COMPONENT" "$REQUEST_TIMEOUT" "OBSIDIAN_REQUEST_TIMEOUT_SECONDS" || exit 1
obsidian_resolve_endpoint "$COMPONENT" || exit 1

if ! command -v curl >/dev/null 2>&1; then
  obsidian_error "$COMPONENT" "curl is required."
  exit 1
fi

response_file="$(mktemp "${TMPDIR:-/tmp}/obsidian-api-check.XXXXXX")"
chmod 600 "$response_file"
trap 'rm -f -- "$response_file"' EXIT

curl_args=(
  --silent
  --show-error
  --connect-timeout "$CONNECT_TIMEOUT"
  --max-time "$REQUEST_TIMEOUT"
  --output "$response_file"
  --write-out '%{http_code}'
)
curl_args+=("${OBSIDIAN_CURL_TLS_ARGS[@]}")

http_code=""
if http_code="$(curl "${curl_args[@]}" "${OBSIDIAN_BASE_URL}/")"; then
  if [[ "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    obsidian_log "$COMPONENT" "OK: native plugin endpoint is reachable at $OBSIDIAN_BASE_URL (HTTP $http_code)."
  else
    obsidian_error "$COMPONENT" "Plugin endpoint returned unexpected HTTP $http_code."
    exit 1
  fi
else
  curl_status=$?
  obsidian_error "$COMPONENT" "Cannot reach $OBSIDIAN_BASE_URL (curl $curl_status, HTTP ${http_code:-000})."
  exit 1
fi

if [[ -z "${OBSIDIAN_API_KEY:-}" ]]; then
  obsidian_warn "$COMPONENT" "OBSIDIAN_API_KEY is not set; authenticated REST and MCP checks were skipped."
  exit 2
fi

http_code=""
if http_code="$(
  obsidian_curl_with_bearer \
    "$COMPONENT" \
    "$OBSIDIAN_API_KEY" \
    "${curl_args[@]}" \
    "${OBSIDIAN_BASE_URL}/vault/"
)"; then
  case "$http_code" in
    2??)
      obsidian_log "$COMPONENT" "OK: OBSIDIAN_API_KEY authenticates successfully (HTTP $http_code)."
      ;;
    401|403)
      obsidian_error "$COMPONENT" "OBSIDIAN_API_KEY was rejected (HTTP $http_code)."
      exit 1
      ;;
    *)
      obsidian_error "$COMPONENT" "Authenticated REST check returned unexpected HTTP $http_code."
      exit 1
      ;;
  esac
else
  curl_status=$?
  obsidian_error "$COMPONENT" "Authenticated REST request failed (curl $curl_status, HTTP ${http_code:-000})."
  exit 1
fi
