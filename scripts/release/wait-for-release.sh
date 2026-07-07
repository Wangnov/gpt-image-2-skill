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
# cargo-dist first, Tauri second.
#
# Merely checking that the Release exists is not enough: if Tauri (or a
# human) created the Release first and cargo-dist is being retried, the
# Release exists while cargo-dist is still about to fail. So this guard
# waits for `dist-manifest.json` — an asset only cargo-dist uploads — which
# proves cargo-dist finished populating the Release.
echo "waiting for cargo-dist to publish $TAG (dist-manifest.json asset; timeout ${TIMEOUT}s, poll ${INTERVAL}s)…"

release_has_dist_manifest() {
  gh release view "$TAG" --json assets \
    --jq '.assets[].name' 2>/dev/null | grep -qx 'dist-manifest.json'
}

elapsed=0
while ! release_has_dist_manifest; do
  if (( elapsed >= TIMEOUT )); then
    echo "timed out after ${TIMEOUT}s waiting for release $TAG to carry dist-manifest.json." >&2
    echo "the cargo-dist 'Release' workflow must create and populate the Release before Tauri runs." >&2
    if gh release view "$TAG" >/dev/null 2>&1; then
      echo "note: the Release exists but has no dist-manifest.json — it was likely created by" >&2
      echo "Tauri or manually; a cargo-dist retry against it will fail with 'already exists'." >&2
    fi
    echo "check it: gh run list --workflow=release.yml --limit 5" >&2
    exit 1
  fi
  sleep "$INTERVAL"
  elapsed=$(( elapsed + INTERVAL ))
done

echo "release $TAG carries dist-manifest.json; cargo-dist populated it — safe to dispatch Tauri App Release."
