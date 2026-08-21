#!/usr/bin/env bash

set +x
set -Eeuo pipefail
unset CAPTURE_TOKEN

readonly COMPONENT="second-brain-install"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly UNIT_SOURCE="$PROJECT_ROOT/deploy/systemd/user"
readonly UNIT_TARGET="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
readonly UNITS=(
  second-brain-code-update.service
  second-brain-code-update.timer
)
readonly LEGACY_UNITS=(
  second-brain-bridge.service
  second-brain.service
  second-brain-healthcheck.service
  second-brain-healthcheck.timer
  second-brain-daily-brief.service
  second-brain-daily-brief.timer
)

log() {
  printf '[%s] %s\n' "$COMPONENT" "$*"
}

render_unit() {
  local content
  content="$(<"$1")"
  content="${content//@PROJECT_ROOT@/$PROJECT_ROOT}"
  printf '%s\n' "$content" >"$2"
}

check_files() {
  local render_dir script unit verify_status=0
  local scripts=(
    "$SCRIPT_DIR/deploy-lib.sh"
    "$SCRIPT_DIR/deploy-healthcheck.sh"
    "$SCRIPT_DIR/deploy-second-brain.sh"
    "$SCRIPT_DIR/deploy-install.sh"
    "$SCRIPT_DIR/generate-daily-brief.sh"
    "$SCRIPT_DIR/deploy-on-main.sh"
    "$SCRIPT_DIR/start-ai-bridge.sh"
  )

  for script in "${scripts[@]}"; do
    bash -n "$script"
  done

  for unit in "${UNITS[@]}"; do
    if [[ ! -f "$UNIT_SOURCE/$unit" ]]; then
      log "ERROR: missing $UNIT_SOURCE/$unit"
      return 1
    fi
  done

  render_dir="$(mktemp -d)"
  for unit in "${UNITS[@]}"; do
    render_unit "$UNIT_SOURCE/$unit" "$render_dir/$unit"
  done
  systemd-analyze --user verify "${UNITS[@]/#/$render_dir/}" || verify_status=$?
  rm -rf -- "$render_dir"
  (( verify_status == 0 )) || return "$verify_status"
  "$SCRIPT_DIR/deploy-second-brain.sh" validate
  log "Scripts, systemd units, Compose access, and secret file passed validation."
}

install_units() {
  local rendered target unit

  check_files
  mkdir -p -- "$UNIT_TARGET"

  rendered="$(mktemp)"
  for unit in "${UNITS[@]}"; do
    target="$UNIT_TARGET/$unit"
    render_unit "$UNIT_SOURCE/$unit" "$rendered"
    if [[ -f "$target" ]] && cmp -s -- "$rendered" "$target"; then
      log "$unit is already current."
    else
      install -m 0644 -- "$rendered" "$target"
      log "Installed $unit."
    fi
  done
  rm -f -- "$rendered"

  systemctl --user daemon-reload
  "$SCRIPT_DIR/start-ai-bridge.sh" stop >/dev/null 2>&1 || true
  systemctl --user disable --now "${LEGACY_UNITS[@]}" 2>/dev/null || true
  rm -f -- "${LEGACY_UNITS[@]/#/$UNIT_TARGET/}"
  "$SCRIPT_DIR/deploy-second-brain.sh" start
  systemctl --user enable --now second-brain-code-update.timer

  linger="$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null || true)"
  if [[ "$linger" != "yes" ]]; then
    log "WARNING: user lingering is disabled; run 'sudo loginctl enable-linger $(id -un)' for unattended morning runs."
  fi

  log "Deployment installed and enabled."
}

uninstall_units() {
  local unit

  systemctl --user disable --now second-brain-code-update.timer 2>/dev/null || true

  for unit in "${UNITS[@]}"; do
    rm -f -- "$UNIT_TARGET/$unit"
  done

  systemctl --user daemon-reload
  systemctl --user reset-failed
  log "Deployment units removed. Application data and Docker resources were preserved."
}

show_status() {
  "$SCRIPT_DIR/deploy-second-brain.sh" status
  systemctl --user --no-pager status second-brain-code-update.timer || true
  systemctl --user --no-pager list-timers 'second-brain-*'
}

usage() {
  printf 'Usage: %s {install|uninstall|check|status}\n' "${0##*/}" >&2
}

case "${1:-install}" in
  install)
    install_units
    ;;
  uninstall)
    uninstall_units
    ;;
  check)
    check_files
    ;;
  status)
    show_status
    ;;
  *)
    usage
    exit 64
    ;;
esac
