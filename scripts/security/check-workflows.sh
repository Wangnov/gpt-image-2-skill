#!/usr/bin/env bash
set -euo pipefail

workflow_dir=".github/workflows"
invalid=0

# Keep this check dependency-free: GitHub's Ubuntu image does not guarantee
# that ripgrep is installed, and a missing scanner must never fail open.
while IFS= read -r file; do
  line_number=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line_number=$((line_number + 1))

    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*uses:[[:space:]]*([^[:space:]#]+) ]]; then
      action_ref="${BASH_REMATCH[1]}"
      if [[ "$action_ref" != ./* && ! "$action_ref" =~ @[0-9a-f]{40}$ ]]; then
        printf '%s:%d: unpinned external Action: %s\n' \
          "$file" "$line_number" "$action_ref" >&2
        invalid=1
      fi
    fi

    shopt -s nocasematch
    if [[ "$line" =~ (curl|wget).*\|[[:space:]]*(ba)?sh([[:space:]]|$) ]] ||
      [[ "$line" =~ (irm|Invoke-RestMethod).*\|[[:space:]]*(iex|Invoke-Expression)([[:space:]]|$) ]]; then
      printf '%s:%d: remote pipe-to-shell execution is forbidden\n' \
        "$file" "$line_number" >&2
      invalid=1
    fi
    shopt -u nocasematch
  done <"$file"
done < <(find "$workflow_dir" -type f \( -name '*.yml' -o -name '*.yaml' \) -print)

if ((invalid != 0)); then
  exit 1
fi

echo "Workflow supply-chain policy: OK"
