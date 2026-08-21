#!/usr/bin/env bash

set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  script_path="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/${BASH_SOURCE[0]##*/}"
  test_repo="$(mktemp -d)"
  git -C "$test_repo" init --quiet
  mkdir -p -- "$test_repo/data"
  printf '{}\n' >"$test_repo/data/oauth-state.json"
  git -C "$test_repo" add data/oauth-state.json
  if (cd -- "$test_repo" && "$script_path" >/dev/null 2>&1); then
    rm -rf -- "$test_repo"
    printf 'Self-test failed: a tracked data file was accepted.\n' >&2
    exit 1
  fi
  git -C "$test_repo" rm --force --quiet data/oauth-state.json
  printf 'owner@private-mail.invalid\n' >"$test_repo/README.md"
  git -C "$test_repo" add README.md
  if (cd -- "$test_repo" && "$script_path" >/dev/null 2>&1); then
    rm -rf -- "$test_repo"
    printf 'Self-test failed: a non-example email was accepted.\n' >&2
    exit 1
  fi
  rm -rf -- "$test_repo"
  printf 'Public repository check self-test passed.\n'
  exit 0
fi

git rev-parse --is-inside-work-tree >/dev/null

failed=0

while IFS= read -r -d '' path; do
  case "$path" in
    .env.example) continue ;;
    data/*|.claude/*|.codex/*|.agents/*|output/*|tmp/*|logs/*|__pycache__/*|*/__pycache__/*|*.bak|*.bak-*)
      if [[ -e "$path" || -L "$path" ]]; then
        printf 'Tracked private/generated path: %s\n' "$path" >&2
        failed=1
      fi
      ;;
    .env|.env.*|*/.env|*/.env.*)
      if [[ -e "$path" || -L "$path" ]]; then
        printf 'Tracked environment file: %s\n' "$path" >&2
        failed=1
      fi
      ;;
  esac
done < <(git ls-files -z)

private_matches="$(git grep -n -I -P '(/SSD/|/home/[^/[:space:]]+|\bPC-[A-Z0-9-]{5,}\b)' -- . ':!scripts/check-public-ready.sh' ':!tests/security-rss.test.ts' | grep -v '/home/assistant' || true)"
if [[ -n "$private_matches" ]]; then
  printf 'Private machine/project references found:\n%s\n' "$private_matches" >&2
  failed=1
fi

email_matches="$(git grep -n -I -i -P '[A-Z0-9._%+-]+@(?![A-Z0-9.-]*example(?:[.][A-Z]{2,})?\b|users[.]noreply[.]github[.]com\b)[A-Z0-9.-]+[.][A-Z]{2,}' -- . ':!scripts/check-public-ready.sh' || true)"
if [[ -n "$email_matches" ]]; then
  printf 'Non-example email addresses found:\n%s\n' "$email_matches" >&2
  failed=1
fi

if (( failed )); then
  exit 1
fi

printf 'Public repository checks passed.\n'
