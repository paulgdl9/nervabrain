#!/usr/bin/env bash

# Shared helpers for Obsidian Local REST API and native MCP scripts.

obsidian_log() {
  local component="$1"
  shift
  printf '[%s] %s\n' "$component" "$*"
}

obsidian_warn() {
  local component="$1"
  shift
  obsidian_log "$component" "WARN: $*" >&2
}

obsidian_error() {
  local component="$1"
  shift
  obsidian_log "$component" "ERROR: $*" >&2
}

obsidian_resolve_endpoint() {
  local component="$1"
  local raw_host="${OBSIDIAN_HOST:-127.0.0.1}"
  local scheme="${OBSIDIAN_SCHEME:-}"
  local port="${OBSIDIAN_PORT:-}"
  local embedded_scheme=""
  local embedded_port=""
  local host_value=""
  local url_host=""
  local colon_characters=""
  local tls_verify=""

  if [[ "$raw_host" =~ ^(https?)://(.*)$ ]]; then
    embedded_scheme="${BASH_REMATCH[1]}"
    raw_host="${BASH_REMATCH[2]}"
  fi
  raw_host="${raw_host%/}"

  if [[ -n "$embedded_scheme" ]]; then
    if [[ -n "$scheme" && "$scheme" != "$embedded_scheme" ]]; then
      obsidian_error "$component" "OBSIDIAN_HOST and OBSIDIAN_SCHEME specify different schemes."
      return 1
    fi
    scheme="$embedded_scheme"
  fi

  if [[ -z "$raw_host" || "$raw_host" =~ [[:space:]/?#@] ]]; then
    obsidian_error "$component" "OBSIDIAN_HOST must be a host name or IP address without path or credentials."
    return 1
  fi

  if [[ "$raw_host" =~ ^\[([^]]+)\](:([0-9]+))?$ ]]; then
    host_value="${BASH_REMATCH[1]}"
    embedded_port="${BASH_REMATCH[3]:-}"
    url_host="[$host_value]"
  elif [[ "$raw_host" =~ ^([^:]+):([0-9]+)$ ]]; then
    host_value="${BASH_REMATCH[1]}"
    embedded_port="${BASH_REMATCH[2]}"
    url_host="$host_value"
  elif [[ "$raw_host" == *:* ]]; then
    colon_characters="${raw_host//[^:]/}"
    if (( ${#colon_characters} < 2 )); then
      obsidian_error "$component" "Put the port in OBSIDIAN_PORT, not OBSIDIAN_HOST."
      return 1
    fi
    host_value="$raw_host"
    url_host="[$host_value]"
  else
    host_value="$raw_host"
    url_host="$host_value"
  fi

  if [[ -n "$embedded_port" ]]; then
    if [[ -n "$port" && "$port" != "$embedded_port" ]]; then
      obsidian_error "$component" "OBSIDIAN_HOST and OBSIDIAN_PORT specify different ports."
      return 1
    fi
    port="$embedded_port"
  fi

  if [[ -z "$scheme" ]]; then
    if [[ "$port" == "27123" ]]; then
      scheme="http"
    else
      scheme="https"
    fi
  fi
  if [[ "$scheme" != "http" && "$scheme" != "https" ]]; then
    obsidian_error "$component" "OBSIDIAN_SCHEME must be http or https."
    return 1
  fi

  if [[ -z "$port" ]]; then
    if [[ "$scheme" == "http" ]]; then
      port="27123"
    else
      port="27124"
    fi
  fi
  if [[ ! "$port" =~ ^[0-9]+$ || ${#port} -gt 5 ]] ||
    (( 10#$port < 1 || 10#$port > 65535 )); then
    obsidian_error "$component" "OBSIDIAN_PORT must be an integer from 1 to 65535."
    return 1
  fi
  port="$((10#$port))"

  OBSIDIAN_CURL_TLS_ARGS=()
  if [[ "$scheme" == "https" ]]; then
    if [[ -n "${OBSIDIAN_CA_CERT:-}" ]]; then
      if [[ ! -r "$OBSIDIAN_CA_CERT" ]]; then
        obsidian_error "$component" "OBSIDIAN_CA_CERT is not readable."
        return 1
      fi
      OBSIDIAN_CURL_TLS_ARGS+=(--cacert "$OBSIDIAN_CA_CERT")
    else
      if [[ "$host_value" == "127.0.0.1" || "$host_value" == "localhost" || "$host_value" == "::1" ]]; then
        tls_verify="${OBSIDIAN_TLS_VERIFY:-0}"
      else
        tls_verify="${OBSIDIAN_TLS_VERIFY:-1}"
      fi
      case "$tls_verify" in
        0|false|FALSE|no|NO)
          OBSIDIAN_CURL_TLS_ARGS+=(--insecure)
          ;;
        1|true|TRUE|yes|YES)
          ;;
        *)
          obsidian_error "$component" "OBSIDIAN_TLS_VERIFY must be 0 or 1."
          return 1
          ;;
      esac
    fi
  fi

  OBSIDIAN_RESOLVED_HOST="$host_value"
  OBSIDIAN_RESOLVED_PORT="$port"
  OBSIDIAN_RESOLVED_SCHEME="$scheme"
  OBSIDIAN_BASE_URL="${scheme}://${url_host}:${port}"
  OBSIDIAN_MCP_URL="${OBSIDIAN_BASE_URL}/mcp/"
}

obsidian_validate_timeout() {
  local component="$1"
  local value="$2"
  local variable_name="$3"

  if [[ ! "$value" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    obsidian_error "$component" "$variable_name must be a non-negative number of seconds."
    return 1
  fi
}

obsidian_curl_with_bearer() {
  local component="$1"
  local api_key="$2"
  local escaped_key=""
  shift 2

  if [[ "$api_key" == *$'\n'* || "$api_key" == *$'\r'* ]]; then
    obsidian_error "$component" "OBSIDIAN_API_KEY contains a line break."
    return 1
  fi

  escaped_key="${api_key//\\/\\\\}"
  escaped_key="${escaped_key//\"/\\\"}"
  printf 'header = "Authorization: Bearer %s"\n' "$escaped_key" |
    curl --config - "$@"
}
