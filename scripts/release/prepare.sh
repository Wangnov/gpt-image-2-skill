#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd cargo
require_cmd dist
require_cmd node
require_cmd npx

cd "$ROOT_DIR"

node scripts/sync_skill_bundle.cjs
node scripts/npm/build-matrix.mjs
cargo fmt --check
cargo test -p "$CRATE_NAME"
cargo run -q -p "$CRATE_NAME" -- --json doctor >/tmp/gpt-image-2-skill-doctor.json
node scripts/smoke_skill_install.cjs >/tmp/gpt-image-2-skill-skill-smoke.json
if {
  if command -v rg >/dev/null 2>&1; then
    rg -q '^allow-dirty = \[[^]]*"ci"[^]]*\]' dist-workspace.toml
  else
    grep -Eq '^allow-dirty = \[[^]]*"ci"[^]]*\]' dist-workspace.toml
  fi
}; then
  echo "skipping dist generate because ci is marked allow-dirty" >/tmp/gpt-image-2-skill-dist-generate.log
else
  dist generate --mode ci >/tmp/gpt-image-2-skill-dist-generate.log
fi
node scripts/release/patch-release-workflow.mjs

echo "prepared $CRATE_NAME $(project_version)"
