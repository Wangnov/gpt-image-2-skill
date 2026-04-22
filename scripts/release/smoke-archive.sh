#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <archive-path>" >&2
  exit 1
fi

ARCHIVE_PATH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

case "$ARCHIVE_PATH" in
  *.zip)
    unzip -q "$ARCHIVE_PATH" -d "$TMP_DIR"
    BINARY_PATH="$(find "$TMP_DIR" -type f -name 'gpt-image-2-skill.exe' | head -n 1)"
    ;;
  *)
    tar -xf "$ARCHIVE_PATH" -C "$TMP_DIR"
    BINARY_PATH="$(find "$TMP_DIR" -type f -name 'gpt-image-2-skill' | head -n 1)"
    ;;
esac

if [[ -z "${BINARY_PATH:-}" ]]; then
  echo "binary not found in archive: $ARCHIVE_PATH" >&2
  exit 1
fi

"$BINARY_PATH" --json doctor
