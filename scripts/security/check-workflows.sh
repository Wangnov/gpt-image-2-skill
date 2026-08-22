#!/usr/bin/env bash
set -euo pipefail

workflow_dir=".github/workflows"

if rg --hidden --no-ignore --pcre2 \
  'uses:\s*(?!\./)[^\s@]+@(?![0-9a-f]{40}(?:\s|$))' \
  "$workflow_dir"; then
  echo "Every external GitHub Action must use a full 40-character commit SHA." >&2
  exit 1
fi

if rg --hidden --no-ignore --pcre2 \
  '(?i:(?:curl|wget)[^\n]*\|\s*(?:ba)?sh\b|(?:irm|Invoke-RestMethod)[^\n]*\|\s*(?:iex|Invoke-Expression)\b)' \
  "$workflow_dir"; then
  echo "Remote pipe-to-shell execution is forbidden in release workflows." >&2
  exit 1
fi

echo "Workflow supply-chain policy: OK"
