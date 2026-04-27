#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CRATE_NAME="gpt-image-2-skill"
CRATE_MANIFEST="$ROOT_DIR/crates/$CRATE_NAME/Cargo.toml"

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "missing required command: $name" >&2
    exit 1
  fi
}

project_version() {
  local version
  version="$(sed -nE 's/^version = "([^"]+)"$/\1/p' "$CRATE_MANIFEST" | head -n1)"
  if [[ -z "$version" ]]; then
    echo "version not found in $CRATE_MANIFEST" >&2
    exit 1
  fi
  printf '%s\n' "$version"
}

project_tag() {
  printf 'v%s\n' "$(project_version)"
}

current_branch() {
  git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD
}

require_clean_worktree() {
  local context="$1"
  if ! git -C "$ROOT_DIR" diff --quiet || ! git -C "$ROOT_DIR" diff --cached --quiet; then
    echo "working tree is dirty after $context; commit or discard these changes before releasing:" >&2
    git -C "$ROOT_DIR" status --short >&2
    exit 1
  fi
}
