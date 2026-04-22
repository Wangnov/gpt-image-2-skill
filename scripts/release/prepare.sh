#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd cargo
require_cmd node
require_cmd npx

cd "$ROOT_DIR"

node scripts/sync_skill_bundle.cjs
node scripts/npm/build-matrix.mjs
cargo fmt --check
cargo test -p "$CRATE_NAME"
cargo run -q -p "$CRATE_NAME" -- --json doctor >/tmp/gpt-image-2-skill-doctor.json
node scripts/smoke_skill_install.cjs >/tmp/gpt-image-2-skill-skill-smoke.json
cargo dist generate --mode ci >/tmp/gpt-image-2-skill-dist-generate.log

echo "prepared $CRATE_NAME $(project_version)"
