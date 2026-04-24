#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to configure trusted publishing"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to inspect npm trust configuration"
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
  gpt-image-2-skill-windows-arm64-msvc
  gpt-image-2-skill-windows-x64-msvc
)

REPO="${REPO:-Wangnov/gpt-image-2-skill}"
WORKFLOW_FILE="${WORKFLOW_FILE:-npm-publish.yml}"

read_trust_field() {
  local json="$1"
  local field="$2"
  TRUST_JSON="$json" TRUST_FIELD="$field" node - <<'NODE'
const raw = process.env.TRUST_JSON ?? "";
if (!raw.trim()) {
  process.exit(0);
}
const data = JSON.parse(raw);
const key = process.env.TRUST_FIELD;
if (data && typeof data === "object" && key in data) {
  process.stdout.write(String(data[key]));
}
NODE
}

created_count=0
existing_count=0

for package_name in "${PACKAGES[@]}"; do
  echo "checking trusted publisher for ${package_name}"
  trust_json="$(npm trust list "${package_name}" --json)"

  if [[ -n "${trust_json}" ]]; then
    trust_id="$(read_trust_field "${trust_json}" id)"
    trust_repo="$(read_trust_field "${trust_json}" repository)"
    trust_file="$(read_trust_field "${trust_json}" file)"

    if [[ "${trust_repo}" != "${REPO}" || "${trust_file}" != "${WORKFLOW_FILE}" ]]; then
      echo "existing trust configuration does not match expected values for ${package_name}"
      echo "expected repository=${REPO} file=${WORKFLOW_FILE}"
      echo "found repository=${trust_repo} file=${trust_file} id=${trust_id}"
      echo "revoke the existing trust first with: npm trust revoke --id ${trust_id} ${package_name}"
      exit 1
    fi

    echo "trusted publisher already configured for ${package_name} id=${trust_id}"
    existing_count=$((existing_count + 1))
    continue
  fi

  echo "creating trusted publisher for ${package_name}"
  npm trust github "${package_name}" --repo "${REPO}" --file "${WORKFLOW_FILE}" --yes
  created_count=$((created_count + 1))
  sleep 2
done

echo "npm trusted publishing ready: total=${#PACKAGES[@]} existing=${existing_count} created=${created_count}"
