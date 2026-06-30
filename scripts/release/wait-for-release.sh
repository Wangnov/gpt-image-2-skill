#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd gh

TAG="${1:-}"
TIMEOUT="${2:-1200}"
INTERVAL="${WAIT_RELEASE_INTERVAL:-15}"

if [[ -z "$TAG" ]]; then
  echo "usage: wait-for-release.sh <tag> [timeout_seconds]" >&2
  exit 1
fi

cd "$ROOT_DIR"

# The cargo-dist "Release" workflow and the "Tauri App Release" workflow both
# create the same GitHub Release. cargo-dist's `gh release create` is NOT
# idempotent (it fails on an existing tag), while Tauri's create-release IS
# (it exits 0 when the release already exists). So the only safe ordering is
# cargo-dist first, Tauri second. This guard blocks until cargo-dist has
# created the Release, so dispatching Tauri can never win the race.
echo "waiting for GitHub Release $TAG to exist (timeout ${TIMEOUT}s, poll ${INTERVAL}s)…"

elapsed=0
while ! gh release view "$TAG" >/dev/null 2>&1; do
  if (( elapsed >= TIMEOUT )); then
    echo "timed out after ${TIMEOUT}s waiting for release $TAG to appear." >&2
    echo "the cargo-dist 'Release' workflow must create the Release before Tauri runs." >&2
    echo "check it: gh run list --workflow=release.yml --limit 5" >&2
    exit 1
  fi
  sleep "$INTERVAL"
  elapsed=$(( elapsed + INTERVAL ))
done

echo "release $TAG exists; cargo-dist created it — safe to dispatch Tauri App Release."
