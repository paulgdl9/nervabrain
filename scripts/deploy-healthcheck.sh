#!/usr/bin/env bash

# Do not let an inherited xtrace setting print deployment state.
set +x
set -Eeuo pipefail
unset CAPTURE_TOKEN

readonly COMPONENT="second-brain-health"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy-lib.sh
source "$SCRIPT_DIR/deploy-lib.sh"

PROJECT_ROOT="$(deploy_resolve_root "$SCRIPT_DIR")" || {
  deploy_error "$COMPONENT" "Unable to resolve the project root."
  exit 1
}
readonly PROJECT_ROOT

readonly BASE_URL="${SECOND_BRAIN_URL:-http://127.0.0.1:3000}"
readonly HEALTH_URL="${BASE_URL%/}/api/health"
readonly ATTEMPTS="${SECOND_BRAIN_HEALTH_ATTEMPTS:-1}"
readonly INTERVAL="${SECOND_BRAIN_HEALTH_INTERVAL_SECONDS:-2}"
readonly CONNECT_TIMEOUT="${SECOND_BRAIN_HEALTH_CONNECT_TIMEOUT_SECONDS:-3}"
readonly REQUEST_TIMEOUT="${SECOND_BRAIN_HEALTH_TIMEOUT_SECONDS:-10}"

deploy_validate_loopback_url "$COMPONENT" "${BASE_URL%/}" || exit 1

if [[ ! "$ATTEMPTS" =~ ^[1-9][0-9]*$ || ! "$INTERVAL" =~ ^[0-9]+$ ]]; then
  deploy_error "$COMPONENT" "Health attempt and interval settings must be positive integers."
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  deploy_error "$COMPONENT" "curl is required."
  exit 1
fi

response_file="$(mktemp "${TMPDIR:-/tmp}/second-brain-health.XXXXXX")"
chmod 600 "$response_file"
trap 'rm -f -- "$response_file"' EXIT

bridge_degraded=0

for ((attempt = 1; attempt <= ATTEMPTS; attempt += 1)); do
  http_code=""
  if http_code="$(
    curl \
      --silent \
      --show-error \
      --fail-with-body \
      --connect-timeout "$CONNECT_TIMEOUT" \
      --max-time "$REQUEST_TIMEOUT" \
      --output "$response_file" \
      --write-out '%{http_code}' \
      "$HEALTH_URL"
  )"; then
    if grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$response_file"; then
      bridge_response=""
      if bridge_response="$(docker compose --project-directory "$PROJECT_ROOT" --file "$PROJECT_ROOT/docker-compose.yml" exec -T ai-bridge \
        python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8089/health', timeout=3).read().decode())" 2>/dev/null)"; then
        if grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' <<<"$bridge_response"; then
          if grep -Eq '"status"[[:space:]]*:[[:space:]]*"healthy"' <<<"$bridge_response"; then
            deploy_log "$COMPONENT" "OK: application and private AI bridge are healthy (HTTP $http_code)."
            exit 0
          fi
          bridge_degraded=1
          deploy_error "$COMPONENT" "DEGRADED: AI bridge has only one available engine."
        else
          deploy_error "$COMPONENT" "AI bridge returned a response without an OK payload."
        fi
      else
        deploy_error "$COMPONENT" "Private AI bridge health attempt $attempt/$ATTEMPTS failed."
      fi
    else
      deploy_error "$COMPONENT" "Health endpoint returned HTTP $http_code without an OK payload."
    fi
  else
    curl_status=$?
    deploy_error "$COMPONENT" "Health attempt $attempt/$ATTEMPTS failed (curl $curl_status, HTTP ${http_code:-000})."
  fi

  if (( attempt < ATTEMPTS )); then
    sleep "$INTERVAL"
  fi
done

if (( bridge_degraded )); then
  deploy_error "$COMPONENT" "AI bridge remained degraded after $ATTEMPTS attempt(s)."
  exit 2
fi
deploy_error "$COMPONENT" "Application did not become healthy after $ATTEMPTS attempt(s)."
exit 1
