#!/usr/bin/env bash

set +x
set -Eeuo pipefail
unset CAPTURE_TOKEN

readonly COMPONENT="second-brain-deploy"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=deploy-lib.sh
source "$SCRIPT_DIR/deploy-lib.sh"

PROJECT_ROOT="$(deploy_resolve_root "$SCRIPT_DIR")" || {
  deploy_error "$COMPONENT" "Unable to resolve the project root."
  exit 1
}
readonly PROJECT_ROOT
readonly TENANTS_FILE="${SECOND_BRAIN_TENANTS_FILE:-$PROJECT_ROOT/data/tenants.conf}"
declare -a TENANT_PROJECTS=()
declare -a TENANT_ROOTS=()

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_tenants() {
  local extra line line_number=0 project root seen_project seen_root

  TENANT_PROJECTS=()
  TENANT_ROOTS=()
  if [[ ! -r "$TENANTS_FILE" ]]; then
    deploy_error "$COMPONENT" "Missing tenant registry: $TENANTS_FILE"
    deploy_error "$COMPONENT" "Copy deploy/tenants.conf.example to data/tenants.conf and configure one profile per line."
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    ((line_number += 1))
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
    IFS='|' read -r project root extra <<<"$line"
    project="$(trim "${project:-}")"
    root="$(trim "${root:-}")"
    if [[ -n "${extra:-}" || ! "$project" =~ ^[a-z0-9][a-z0-9_-]{0,62}$ ]]; then
      deploy_error "$COMPONENT" "Invalid tenant entry on line $line_number (expected project|absolute-root)."
      return 1
    fi
    if [[ "$root" != /* || "$root" == "/" ]] || ! sudo -n test -d "$root"; then
      deploy_error "$COMPONENT" "Invalid tenant root on line $line_number: $root"
      return 1
    fi
    root="$(sudo -n realpath -e -- "$root")"
    if ! sudo -n test -f "$root/.env" || ! sudo -n test -d "$root/vault"; then
      deploy_error "$COMPONENT" "$root must contain a private .env and a vault directory."
      return 1
    fi
    for seen_project in "${TENANT_PROJECTS[@]}"; do
      [[ "$seen_project" != "$project" ]] || {
        deploy_error "$COMPONENT" "Duplicate tenant project: $project"
        return 1
      }
    done
    for seen_root in "${TENANT_ROOTS[@]}"; do
      [[ "$seen_root" != "$root" ]] || {
        deploy_error "$COMPONENT" "Duplicate tenant root: $root"
        return 1
      }
    done
    TENANT_PROJECTS+=("$project")
    TENANT_ROOTS+=("$root")
  done <"$TENANTS_FILE"

  if (( ${#TENANT_PROJECTS[@]} == 0 )); then
    deploy_error "$COMPONENT" "The tenant registry is empty: $TENANTS_FILE"
    return 1
  fi
}

profile_compose() {
  local project="$1" root="$2" owner runtime_compose
  shift 2
  owner="$(sudo -n stat -c '%U' "$root")"
  runtime_compose="$root/data/runtime/docker-compose.yml"
  sudo -n -u "$owner" env SECOND_BRAIN_PROFILE_ROOT="$root" docker compose \
    --project-name "$project" --project-directory "$root" --env-file "$root/.env" \
    --file "$runtime_compose" "$@"
}

validate_profile() {
  local project="$1" root="$2" env_file expected_uid mode mode_value owner
  env_file="$root/.env"
  owner="$(sudo -n stat -c '%U' "$root")"
  expected_uid="$(sudo -n stat -c '%u' "$root")"
  mode="$(sudo -n stat -c '%a' "$env_file")"
  mode_value=$((8#$mode))
  if (( (mode_value & 077) != 0 )) || [[ "$(sudo -n stat -c '%u' "$env_file")" != "$expected_uid" ]]; then
    deploy_error "$COMPONENT" "$env_file must be mode 600 and owned by $owner."
    return 1
  fi
  sudo -n bash -c 'source "$1"; deploy_load_capture_token "$2" "$3"' \
    _ "$SCRIPT_DIR/deploy-lib.sh" "$COMPONENT" "$env_file"
  deploy_log "$COMPONENT" "Validated tenant $project in $root."
}

prepare_profile() {
  local root="$1" owner group runtime_compose
  owner="$(sudo -n stat -c '%U' "$root")"
  group="$(sudo -n stat -c '%G' "$root")"
  sudo -n -u "$owner" install -d -m 700 "$root/data/ai-home" "$root/data/garmin" "$root/data/runtime"
  runtime_compose="$root/data/runtime/docker-compose.yml"
  sudo -n install -o "$owner" -g "$group" -m 600 "$PROJECT_ROOT/docker-compose.yml" "$runtime_compose"
}

build_images() {
  deploy_log "$COMPONENT" "Building the three shared production images once."
  SECOND_BRAIN_PROFILE_ROOT="$PROJECT_ROOT" docker compose \
    --project-directory "$PROJECT_ROOT" --file "$PROJECT_ROOT/docker-compose.yml" \
    build ai-bridge garmin-sync second-brain
}

deploy_profile() {
  local project="$1" root="$2"
  deploy_log "$COMPONENT" "Deploying isolated tenant $project."
  prepare_profile "$root"
  profile_compose "$project" "$root" up --detach --no-build --wait --wait-timeout 90 \
    ai-bridge garmin-sync second-brain
}

health_profile() {
  local project="$1" root="$2"
  profile_compose "$project" "$root" exec -T second-brain \
    wget -q -O - http://127.0.0.1:3000/api/health | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
  profile_compose "$project" "$root" exec -T ai-bridge python3 -c \
    "import json, urllib.request; assert json.load(urllib.request.urlopen('http://127.0.0.1:8089/health', timeout=3))['ok'] is True"
  deploy_log "$COMPONENT" "Tenant $project is healthy."
}

validate() {
  local required index
  for required in docker realpath stat sudo; do
    command -v "$required" >/dev/null 2>&1 || {
      deploy_error "$COMPONENT" "$required is required."
      return 1
    }
  done
  [[ -f "$PROJECT_ROOT/docker-compose.yml" ]] || {
    deploy_error "$COMPONENT" "Missing $PROJECT_ROOT/docker-compose.yml."
    return 1
  }
  docker compose version >/dev/null
  sudo -n true
  load_tenants
  for index in "${!TENANT_PROJECTS[@]}"; do
    validate_profile "${TENANT_PROJECTS[$index]}" "${TENANT_ROOTS[$index]}"
  done
  deploy_log "$COMPONENT" "Tenant registry validation passed."
}

start() {
  local index
  validate
  build_images
  for index in "${!TENANT_PROJECTS[@]}"; do
    deploy_profile "${TENANT_PROJECTS[$index]}" "${TENANT_ROOTS[$index]}"
  done
  for index in "${!TENANT_PROJECTS[@]}"; do
    health_profile "${TENANT_PROJECTS[$index]}" "${TENANT_ROOTS[$index]}"
  done
  deploy_log "$COMPONENT" "All tenants are running on isolated data and credentials."
}

stop() {
  local index
  load_tenants
  for index in "${!TENANT_PROJECTS[@]}"; do
    profile_compose "${TENANT_PROJECTS[$index]}" "${TENANT_ROOTS[$index]}" stop second-brain ai-bridge garmin-sync
  done
}

status() {
  local index
  load_tenants
  for index in "${!TENANT_PROJECTS[@]}"; do
    deploy_log "$COMPONENT" "Tenant ${TENANT_PROJECTS[$index]}"
    profile_compose "${TENANT_PROJECTS[$index]}" "${TENANT_ROOTS[$index]}" ps second-brain ai-bridge garmin-sync
  done
}

health() {
  local index
  load_tenants
  for index in "${!TENANT_PROJECTS[@]}"; do
    health_profile "${TENANT_PROJECTS[$index]}" "${TENANT_ROOTS[$index]}"
  done
}

usage() {
  printf 'Usage: %s {start|stop|restart|health|status|validate}\n' "${0##*/}" >&2
}

case "${1:-}" in
  start|restart) start ;;
  stop) stop ;;
  health) health ;;
  status) status ;;
  validate) validate ;;
  *) usage; exit 64 ;;
esac
