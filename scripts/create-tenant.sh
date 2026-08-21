#!/usr/bin/env bash
#
# Provision (or tear down) an isolated tenant profile in one idempotent command.
#
#   scripts/create-tenant.sh create <project> <root> [--port N] [--bind ADDR] [--plan free|plus|pro]
#   scripts/create-tenant.sh destroy <project> <root>
#
# `create` lays down the tenant root, a mode-600 .env with fresh secrets and a
# non-colliding host port, a seeded vault, and the data/ subdirectories, then
# registers the profile in data/tenants.conf. It refuses a project name, root
# path, or host port already taken by a registered profile, so re-running it is
# safe. It never builds images or starts containers — deployment stays gated
# behind scripts/deploy-second-brain.sh (see CLAUDE.md). Cloudflare exposure is
# printed as a remaining manual step because it needs per-deployment DNS and
# Access configuration this script has no credentials for.
#
# `destroy` removes the registry entry and the tenant root. Containers must
# already be stopped (scripts/deploy-second-brain.sh stop) — this script does
# not touch Docker.
set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly TENANTS_FILE="${SECOND_BRAIN_TENANTS_FILE:-$PROJECT_ROOT/data/tenants.conf}"
readonly PORT_BASE=3000

log() { printf '[create-tenant] %s\n' "$*"; }
die() { printf '[create-tenant] error: %s\n' "$*" >&2; exit 1; }

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-32}"
  else node -e "console.log(require('crypto').randomBytes(${1:-32}).toString('hex'))"; fi
}

# Registered "project|root" lines, comments and blanks stripped.
registry_entries() {
  [[ -f "$TENANTS_FILE" ]] || return 0
  grep -vE '^\s*(#|$)' "$TENANTS_FILE" || true
}

# Host port recorded in a registered root's .env (empty if unreadable/unset).
port_of_root() {
  local env_file="$1/.env" line
  [[ -r "$env_file" ]] || return 0
  line="$(grep -E '^SECOND_BRAIN_PORT=' "$env_file" 2>/dev/null | tail -1)" || true
  printf '%s' "${line#SECOND_BRAIN_PORT=}"
}

# Lowest port at or above PORT_BASE not already used by a registered profile.
next_free_port() {
  local -A used=() entry root port candidate
  while IFS='|' read -r _ root; do
    [[ -n "$root" ]] || continue
    port="$(port_of_root "$root")"
    if [[ -n "$port" ]]; then used["$port"]=1; fi
  done < <(registry_entries)
  for (( candidate = PORT_BASE; candidate < PORT_BASE + 1000; candidate++ )); do
    if [[ -z "${used[$candidate]:-}" ]]; then printf '%s' "$candidate"; return 0; fi
  done
  die "no free port found in [$PORT_BASE, $((PORT_BASE + 1000)))"
}

assert_no_collision() {
  local project="$1" root="$2" port="$3" e_project e_root
  while IFS='|' read -r e_project e_root; do
    [[ -n "$e_project" ]] || continue
    if [[ "$e_project" == "$project" ]]; then die "project '$project' is already registered"; fi
    if [[ "$e_root" == "$root" ]]; then die "root '$root' is already registered"; fi
    if [[ -n "$port" && "$(port_of_root "$e_root")" == "$port" ]]; then
      die "port $port is already used by registered profile '$e_project'"
    fi
  done < <(registry_entries)
}

write_env() {
  local root="$1" port="$2" bind="$3" plan="$4" env_file="$root/.env"
  umask 077
  cp "$PROJECT_ROOT/.env.example" "$env_file"
  set_env() {
    local key="$1" value="$2" tmp; tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      $0 ~ "^" k "=" { print k "=" v; done=1; next } { print }
      END { if (!done) print k "=" v }' "$env_file" > "$tmp"
    mv "$tmp" "$env_file"
  }
  set_env SECOND_BRAIN_VAULT "./vault"
  set_env SECOND_BRAIN_PORT "$port"
  set_env SECOND_BRAIN_BIND "$bind"
  set_env SECOND_BRAIN_UID "$(id -u)"
  set_env SECOND_BRAIN_GID "$(id -g)"
  set_env SECOND_BRAIN_PLAN "$plan"
  set_env CAPTURE_TOKEN "$(rand_hex 32)"
  set_env SESSION_SECRET "$(rand_hex 32)"
  set_env MEMO_TOKEN "$(rand_hex 32)"
  set_env DASHBOARD_PASSWORD "brain-$(rand_hex 6)"
  chmod 600 "$env_file"
}

cmd_create() {
  local project="$1" root="$2" port="" bind="127.0.0.1" plan="free"
  shift 2
  while (( $# )); do
    case "$1" in
      --port) port="$2"; shift 2 ;;
      --bind) bind="$2"; shift 2 ;;
      --plan) plan="$2"; shift 2 ;;
      *) die "unknown option: $1" ;;
    esac
  done
  case "$plan" in free|plus|pro) ;; *) die "plan must be free, plus, or pro" ;; esac
  [[ "$project" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "project must match [a-z0-9-] and start alphanumeric"
  [[ "$root" = /* ]] || die "root must be an absolute path"

  [[ -n "$port" ]] || port="$(next_free_port)"
  [[ "$port" =~ ^[0-9]+$ ]] || die "port must be numeric"
  assert_no_collision "$project" "$root" "$port"

  log "creating tenant '$project' (plan $plan) at $root on ${bind}:${port}"
  mkdir -p "$root/vault" "$root/data/ai-home" "$root/data/garmin" "$root/data/runtime"
  chmod 700 "$root/data/ai-home" "$root/data/garmin"

  write_env "$root" "$port" "$bind" "$plan"

  log "seeding vault"
  ( cd "$PROJECT_ROOT" && SECOND_BRAIN_VAULT="$root/vault" npx tsx scripts/seed-vault.ts )

  printf '%s|%s\n' "$project" "$root" >> "$TENANTS_FILE"
  log "registered in $TENANTS_FILE"

  cat <<EOF

Tenant '$project' provisioned. Remaining manual steps (need external credentials):
  1. Cloudflare: add a DNS record + tunnel route for this tenant's hostname to
     ${bind}:${port}, and an Access application if the profile is protected.
  2. Deploy (gated, user-requested): scripts/deploy-second-brain.sh start
  3. First-run setup: open the tenant hostname /setup once it is deployed.
EOF
}

cmd_destroy() {
  local project="$1" root="$2"
  [[ -n "$project" && -n "$root" ]] || die "usage: destroy <project> <root>"
  local found=""
  while IFS='|' read -r e_project e_root; do
    [[ "$e_project" == "$project" && "$e_root" == "$root" ]] && found=1
  done < <(registry_entries)
  [[ -n "$found" ]] || die "no registered profile '$project' at '$root'"

  log "removing '$project' from $TENANTS_FILE"
  local tmp; tmp="$(mktemp)"
  grep -vE "^\s*${project}\|${root}\s*$" "$TENANTS_FILE" > "$tmp" || true
  mv "$tmp" "$TENANTS_FILE"

  if [[ -d "$root" ]]; then
    log "removing tenant root $root"
    rm -rf "$root"
  fi
  log "destroyed '$project' (stop its containers first if still running)"
}

main() {
  local action="${1:-}"
  case "$action" in
    create) shift; [[ $# -ge 2 ]] || die "usage: create <project> <root> [--port N] [--bind ADDR] [--plan free|plus|pro]"; cmd_create "$@" ;;
    destroy) shift; cmd_destroy "${1:-}" "${2:-}" ;;
    *) printf 'Usage: %s {create <project> <root> [--port N] [--bind ADDR] [--plan free|plus|pro]|destroy <project> <root>}\n' "${0##*/}" >&2; exit 2 ;;
  esac
}

main "$@"
