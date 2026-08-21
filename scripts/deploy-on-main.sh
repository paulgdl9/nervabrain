#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
readonly MARKER="$PROJECT_ROOT/data/deployed-main"

exec 9>"$PROJECT_ROOT/data/deploy-on-main.lock"
flock --nonblock 9 || exit 0

cd "$PROJECT_ROOT"
git diff --quiet && git diff --cached --quiet || exit 0
[[ "$(git branch --show-current)" == "main" ]] || exit 0
git fetch --quiet origin main
local_revision="$(git rev-parse HEAD)"
remote_revision="$(git rev-parse origin/main)"
if [[ "$local_revision" != "$remote_revision" ]]; then
  git merge-base --is-ancestor "$local_revision" "$remote_revision" || exit 0
  git merge --ff-only "$remote_revision"
  local_revision="$(git rev-parse HEAD)"
fi
[[ ! -f "$MARKER" || "$(<"$MARKER")" != "$local_revision" ]] || exit 0

"$SCRIPT_DIR/deploy-second-brain.sh" start
printf '%s\n' "$local_revision" >"$MARKER"
