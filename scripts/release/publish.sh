#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd cargo
require_cmd git
require_cmd node

EXECUTE=0
LEVEL_OR_VERSION="patch"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute)
      EXECUTE=1
      shift
      ;;
    *)
      LEVEL_OR_VERSION="$1"
      shift
      ;;
  esac
done

"$ROOT_DIR/scripts/release/prepare.sh"

cd "$ROOT_DIR"

BRANCH="$(current_branch)"
COMMON_ARGS=(
  --workspace
  --allow-branch "$BRANCH"
  --no-confirm
)
VERSION_ARGS=(
  "$LEVEL_OR_VERSION"
  "${COMMON_ARGS[@]}"
)

if [[ "$EXECUTE" -eq 1 ]]; then
  require_clean_worktree "release preparation"
  cargo release version "${VERSION_ARGS[@]}" --execute
  "$ROOT_DIR/scripts/release/prepare.sh"
  git add \
    Cargo.lock \
    crates/gpt-image-2-core/Cargo.toml \
    crates/gpt-image-2-skill/Cargo.toml \
    apps/gpt-image-2-app/src-tauri/Cargo.toml \
    apps/gpt-image-2-app/src-tauri/tauri.conf.json \
    apps/gpt-image-2-app/package.json \
    apps/gpt-image-2-app/package-lock.json \
    skills/gpt-image-2-skill/scripts/gpt_image_2_skill.cjs \
    skills/gpt-image-2-skill/scripts/selftest.cjs \
    packages/npm
  git commit -m "release: $(project_version)"
  cargo release publish "${COMMON_ARGS[@]}" --execute
  cargo release tag "${COMMON_ARGS[@]}" --execute
  cargo release push "${COMMON_ARGS[@]}" --execute
  echo "published $(project_tag)"
else
  require_clean_worktree "release preparation"
  cargo release "${VERSION_ARGS[@]}"
  echo "dry run complete for $(project_tag) -> ${LEVEL_OR_VERSION}"
fi
