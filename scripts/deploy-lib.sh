#!/usr/bin/env bash

# Shared helpers for deployment scripts. This file must be sourced.

deploy_log() {
  local component="$1"
  shift
  printf '[%s] %s\n' "$component" "$*"
}

deploy_error() {
  local component="$1"
  shift
  deploy_log "$component" "ERROR: $*" >&2
}

deploy_resolve_root() {
  local script_dir="$1"
  local requested_root="${SECOND_BRAIN_ROOT:-$script_dir/..}"

  if ! cd -- "$requested_root" 2>/dev/null; then
    return 1
  fi
  pwd -P
}

deploy_validate_env_permissions() {
  local component="$1"
  local env_file="$2"
  local mode mode_value owner

  if [[ ! -f "$env_file" ]]; then
    deploy_error "$component" "Missing $env_file. Create it before deploying."
    return 1
  fi

  mode="$(stat -c '%a' "$env_file")"
  mode_value=$((8#$mode))
  if (( (mode_value & 077) != 0 )); then
    deploy_error "$component" "$env_file must not be readable by group or others (run: chmod 600 .env)."
    return 1
  fi

  owner="$(stat -c '%u' "$env_file")"
  if [[ "$owner" != "$(id -u)" ]]; then
    deploy_error "$component" "$env_file must be owned by the service user."
    return 1
  fi
}

deploy_load_capture_token() {
  local component="$1"
  local env_file="$2"
  local line value="" matches=0

  DEPLOY_CAPTURE_TOKEN=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^[[:space:]]*CAPTURE_TOKEN[[:space:]]*=(.*)$ ]]; then
      value="${BASH_REMATCH[1]}"
      ((matches += 1))
    fi
  done < "$env_file"

  if (( matches != 1 )); then
    deploy_error "$component" "$env_file must contain exactly one CAPTURE_TOKEN assignment."
    return 1
  fi

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"

  if (( ${#value} >= 2 )); then
    if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi

  if [[ "$value" == "replace-with-random-token" || ${#value} -lt 32 || ${#value} -gt 512 ]]; then
    deploy_error "$component" "CAPTURE_TOKEN must be a non-placeholder secret between 32 and 512 characters."
    return 1
  fi

  if [[ ! "$value" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
    deploy_error "$component" "CAPTURE_TOKEN contains unsupported characters; use a hex or base64-style token."
    return 1
  fi

  DEPLOY_CAPTURE_TOKEN="$value"
}

deploy_validate_loopback_url() {
  local component="$1"
  local url="$2"

  if [[ ! "$url" =~ ^http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?$ ]]; then
    deploy_error "$component" "SECOND_BRAIN_URL must be a loopback HTTP origin such as http://127.0.0.1:3000."
    return 1
  fi
}
