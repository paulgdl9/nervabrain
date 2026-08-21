#!/usr/bin/env bash

# CAPTURE_TOKEN must never be emitted by shell tracing, command arguments, or logs.
set +x
set -Eeuo pipefail
unset CAPTURE_TOKEN

readonly COMPONENT="second-brain-daily-brief"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy-lib.sh
source "$SCRIPT_DIR/deploy-lib.sh"

PROJECT_ROOT="$(deploy_resolve_root "$SCRIPT_DIR")" || {
  deploy_error "$COMPONENT" "Unable to resolve the project root."
  exit 1
}
readonly PROJECT_ROOT
readonly ENV_FILE="$PROJECT_ROOT/.env"
readonly BASE_URL="${SECOND_BRAIN_URL:-http://127.0.0.1:3000}"
readonly BRIEF_URL="${BASE_URL%/}/api/automation/daily"
readonly REQUEST_TIMEOUT="${SECOND_BRAIN_BRIEF_TIMEOUT_SECONDS:-840}"

deploy_validate_loopback_url "$COMPONENT" "${BASE_URL%/}" || exit 1
deploy_validate_env_permissions "$COMPONENT" "$ENV_FILE" || exit 1

for required in curl flock python3; do
  if ! command -v "$required" >/dev/null 2>&1; then
    deploy_error "$COMPONENT" "$required is required."
    exit 1
  fi
done

lock_root="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
lock_file="$lock_root/second-brain-daily-brief-$(id -u).lock"
exec 9>"$lock_file"
if ! flock --nonblock 9; then
  deploy_log "$COMPONENT" "Another daily brief generation is already running; nothing to do."
  exit 0
fi

SECOND_BRAIN_ROOT="$PROJECT_ROOT" "$SCRIPT_DIR/deploy-healthcheck.sh"

deploy_load_capture_token "$COMPONENT" "$ENV_FILE" || exit 1
capture_token="$DEPLOY_CAPTURE_TOKEN"
unset DEPLOY_CAPTURE_TOKEN

response_file="$(mktemp "${TMPDIR:-/tmp}/second-brain-brief.XXXXXX")"
chmod 600 "$response_file"
cleanup() {
  unset capture_token
  rm -f -- "$response_file"
}
trap cleanup EXIT

deploy_log "$COMPONENT" "Requesting the daily knowledge automation."
http_code=""
if http_code="$(
  printf 'header = "X-Capture-Token: %s"\n' "$capture_token" |
    curl \
      --config - \
      --silent \
      --show-error \
      --fail-with-body \
      --connect-timeout 5 \
      --max-time "$REQUEST_TIMEOUT" \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary '{"forceBrief":false}' \
      --output "$response_file" \
      --write-out '%{http_code}' \
      "$BRIEF_URL"
)"; then
  unset capture_token
else
  curl_status=$?
  unset capture_token
  deploy_error "$COMPONENT" "Brief generation request failed (curl $curl_status, HTTP ${http_code:-000}). Response body was not logged."
  exit 1
fi

if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
  deploy_error "$COMPONENT" "Brief generation returned unexpected HTTP $http_code. Response body was not logged."
  exit 1
fi

validation_reason=""
if ! validation_reason="$(python3 - "$response_file" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as response:
        payload = json.load(response)
except (OSError, ValueError, TypeError):
    print("invalid-json")
    raise SystemExit(1)

if not isinstance(payload, dict) or payload.get("ok") is not True:
    print("not-ok")
    raise SystemExit(1)
if payload.get("errors"):
    print("partial-errors")
    raise SystemExit(1)
if payload.get("degraded") is True or payload.get("status") in {"degraded", "failed"}:
    print("degraded")
    raise SystemExit(1)
if payload.get("fallbackCount") not in (None, 0, "0"):
    print("local-fallback")
    raise SystemExit(1)
generated_by = str(payload.get("generatedBy") or "")
if not generated_by.startswith("ai:"):
    print("brief-not-generated-by-ai")
    raise SystemExit(1)
print("healthy")
PY
)"; then
  deploy_error "$COMPONENT" "Brief generation completed with an unhealthy automation state (${validation_reason:-unknown}). Response body was not logged."
  exit 1
fi

deploy_log "$COMPONENT" "Daily knowledge automation completed successfully with AI (HTTP $http_code)."
