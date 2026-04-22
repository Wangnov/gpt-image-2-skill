#!/usr/bin/env bash
set -euo pipefail

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
