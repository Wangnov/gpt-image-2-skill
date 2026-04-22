#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to configure trusted publishing"
  exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "npm trust needs an interactive npm account session with account-level 2FA enabled."
  echo "Run npm login, approve the first trust action in the browser, enable the 5-minute skip window, then rerun this script."
  exit 1
fi

PACKAGES=(
  gpt-image-2-skill
  gpt-image-2-skill-darwin-arm64
  gpt-image-2-skill-darwin-x64
  gpt-image-2-skill-linux-arm64-gnu
  gpt-image-2-skill-linux-x64-gnu
  gpt-image-2-skill-linux-x64-musl
  gpt-image-2-skill-windows-arm64-msvc
  gpt-image-2-skill-windows-x64-msvc
)

REPO="Wangnov/gpt-image-2-skill"
WORKFLOW_FILE="npm-publish.yml"

for package_name in "${PACKAGES[@]}"; do
  echo "configuring trusted publisher for ${package_name}"
  npm trust github "${package_name}" --repo "${REPO}" --file "${WORKFLOW_FILE}" --yes
  sleep 2
done

echo "configured npm trusted publishing for ${#PACKAGES[@]} packages"
