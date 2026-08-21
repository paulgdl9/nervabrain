#!/usr/bin/env sh

set -eu

case "$GARMIN_SYNC_SCRIPT" in
  /sync/garmin-sync-profile.py) ;;
  *) echo "[garmin-schedule] unsupported sync script" >&2; exit 64 ;;
esac

mkdir -p "$GARMINTOKENS"
marker="$GARMINTOKENS/.last-sync-slot"
request="$GARMINTOKENS/sync.request"

run_sync() {
  slot="$1"
  [ "$(cat "$marker" 2>/dev/null || true)" = "$slot" ] && return 0
  if python "$GARMIN_SYNC_SCRIPT"; then
    printf '%s\n' "$slot" > "$marker"
  else
    echo "[garmin-schedule] sync failed; it will be retried" >&2
  fi
}

run_sync "$(date +%F)-startup"
while sleep 2; do
  if [ -f "$request" ]; then
    rm -f "$request"
    run_sync "$(date +%s)-manual"
    continue
  fi
  now="$(date +%H:%M)"
  case ",${GARMIN_SYNC_TIMES}," in
    *",$now,"*) run_sync "$(date +%F)-$now" ;;
  esac
done
