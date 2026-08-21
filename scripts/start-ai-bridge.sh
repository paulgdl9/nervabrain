#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$ROOT/.env"
PID_FILE="$ROOT/data/memo-bridge.pid"
LOG_FILE="$ROOT/data/memo-bridge.log"

env_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ENV_FILE" 2>/dev/null || true
}

running_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(<"$PID_FILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null && printf '%s' "$pid"
}

start() {
  local credentials_file key pid token value work_dir
  local -a bridge_env
  if pid="$(running_pid)"; then
    printf 'AI bridge already running (PID %s).\n' "$pid"
    return
  fi
  command -v python3 >/dev/null 2>&1 || { printf 'python3 is required to start the AI bridge.\n' >&2; return 1; }
  token="$(env_value MEMO_TOKEN)"
  [[ -n "$token" ]] || { printf 'Run ./scripts/init-env.sh first.\n' >&2; return 1; }
  credentials_file="$(env_value AI_CREDENTIALS_FILE)"
  work_dir="$ROOT/data/runtime/ai-bridge"
  mkdir -p "$ROOT/data" "$work_dir"
  chmod 0700 "$work_dir"
  rm -f "$PID_FILE"
  umask 077
  # Relative credential paths are resolved by both runtimes inside their
  # shared ./data volume; keep the raw relative value identical here.
  bridge_env=("MEMO_TOKEN=$token" "AI_CREDENTIALS_FILE=${credentials_file:-ai-credentials.env}")
  for key in MEMO_PORT MEMO_BIND MEMO_MAX_CONCURRENCY MEMO_AREAS MEMO_ENGINE_ORDER WEEKLY_LANGUAGE BRIEF_MODEL PROCESS_MODEL WEEKLY_MODEL DEDUPE_MODEL PLAN_MODEL WEEKLY_PROMPT_FILE BRIEF_BUDGET PROCESS_BUDGET PLAN_BUDGET CODEX_RESERVE_SECONDS ENGINE_MIN_SECONDS CLAUDE_BIN CODEX_BIN; do
    value="$(env_value "$key")"
    [[ -n "$value" ]] && bridge_env+=("$key=$value")
  done
  cd -- "$work_dir"
  nohup env "${bridge_env[@]}" python3 "$ROOT/bridge/memo-bridge.py" >>"$LOG_FILE" 2>&1 </dev/null &
  pid=$!
  printf '%s\n' "$pid" >"$PID_FILE"
  sleep .25
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    printf 'AI bridge could not start. See %s.\n' "$LOG_FILE" >&2
    return 1
  fi
  printf 'AI bridge started in the background (PID %s, log: %s).\n' "$pid" "$LOG_FILE"
}

stop() {
  local pid
  if ! pid="$(running_pid)"; then
    rm -f "$PID_FILE"
    printf 'AI bridge is not running.\n'
    return
  fi
  kill "$pid"
  rm -f "$PID_FILE"
  printf 'AI bridge stopped.\n'
}

status() {
  local pid
  if pid="$(running_pid)"; then
    printf 'AI bridge is running (PID %s).\n' "$pid"
  else
    printf 'AI bridge is not running.\n'
    return 1
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  *) printf 'Usage: %s {start|stop|restart|status}\n' "${0##*/}" >&2; exit 64 ;;
esac
