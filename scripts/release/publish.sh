#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd cargo
require_cmd git

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
ARGS=(
  "$LEVEL_OR_VERSION"
  --workspace
  --allow-branch "$BRANCH"
  --no-confirm
)

if [[ "$EXECUTE" -eq 1 ]]; then
  cargo release "${ARGS[@]}" --execute
  git push origin "$BRANCH" --follow-tags
  echo "published $(project_tag)"
else
  cargo release "${ARGS[@]}"
  echo "dry run complete for $(project_tag)"
fi
