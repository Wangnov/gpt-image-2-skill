#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd cargo
require_cmd node
require_cmd npx

RELEASE_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-dir)
      RELEASE_DIR="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

cd "$ROOT_DIR"

node scripts/sync_skill_bundle.cjs
if [[ -n "$RELEASE_DIR" ]]; then
  node scripts/npm/build-matrix.mjs --release-dir "$RELEASE_DIR"
else
  node scripts/npm/build-matrix.mjs --check
fi
cargo test -p "$CRATE_NAME"
cargo run -q -p "$CRATE_NAME" -- --json doctor >/tmp/gpt-image-2-skill-verify-doctor.json
node scripts/smoke_skill_install.cjs >/tmp/gpt-image-2-skill-verify-skill.json

echo "verified $CRATE_NAME $(project_version)"
