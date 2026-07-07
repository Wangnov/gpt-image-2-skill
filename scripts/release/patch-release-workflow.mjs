#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const workflowPath = path.join(rootDir, ".github", "workflows", "release.yml");

const insertAfter = `      - name: Install dependencies
        run: |
          \${{ matrix.packages_install }}
`;

const buildMarker = "      - name: Build artifacts";
const muslStepName = "      - name: Configure musl toolchain";
const muslStepPattern =
  /      - name: Configure musl toolchain\n        if: \$\{\{ runner\.os == 'Linux' && contains\(join\(matrix\.targets, ','\), 'unknown-linux-musl'\) \}\}\n        shell: bash\n        run: \|\n(?:.*\n)+?(?=      - name: (?:Refresh WiX path|Build artifacts))/;
const wixStepName = "      - name: Refresh WiX path";
const announceSectionMarker = "  announce:\n";
const announceCheckoutMarker = `      - uses: actions/checkout@v6
        with:
          persist-credentials: false
          submodules: recursive
`;
const dispatchStepName = "      - name: Dispatch npm publish workflow";
const dispatchStepPattern =
  /      - name: Dispatch npm publish workflow\n        run: gh workflow run "Publish npm Packages" --repo "\$\{\{ github\.repository \}\}" -f tag="\$\{\{ needs\.plan\.outputs\.tag \}\}"\n(?:      - name: Dispatch static Pages deploy workflow\n        run: gh workflow run "Deploy Static Page" --repo "\$\{\{ github\.repository \}\}" -f tag="\$\{\{ needs\.plan\.outputs\.tag \}\}"\n)?(?:      - name: Dispatch GHCR image publish workflow\n        run: gh workflow run "Publish GHCR Image" --repo "\$\{\{ github\.repository \}\}" -f ref="\$\{\{ needs\.plan\.outputs\.tag \}\}"\n)?/g;
const permissionsBlock = `permissions:
  "contents": "write"
`;
const expandedPermissionsBlock = `permissions:
  "contents": "write"
  "actions": "write"
`;

const wixStep = `      - name: Refresh WiX path
        if: \${{ contains(join(matrix.targets, ','), 'aarch64-pc-windows-msvc') }}
        shell: pwsh
        run: |
          $wixRoot = [Environment]::GetEnvironmentVariable("WIX", "Machine")
          if (-not $wixRoot) {
            $candidates = @(
              Get-ChildItem "\${env:ProgramFiles(x86)}" -Directory -Filter "WiX Toolset v*" -ErrorAction SilentlyContinue
              Get-ChildItem "\${env:ProgramFiles}" -Directory -Filter "WiX Toolset v*" -ErrorAction SilentlyContinue
            ) | Sort-Object FullName -Descending
            if ($candidates.Count -eq 0) {
              throw "WiX installation root not found after Chocolatey install"
            }
            $wixRoot = $candidates[0].FullName
          }

          Add-Content -Path $env:GITHUB_ENV -Value "WIX=$wixRoot"
          Add-Content -Path $env:GITHUB_PATH -Value (Join-Path $wixRoot "bin")
          Write-Host "Using WiX root $wixRoot"
`;

const muslStep = `      - name: Configure musl toolchain
        if: \${{ runner.os == 'Linux' && contains(join(matrix.targets, ','), 'unknown-linux-musl') }}
        shell: bash
        run: |
          if command -v sudo >/dev/null 2>&1; then
            sudo apt-get update
            sudo apt-get install -y musl-tools
          else
            apt-get update
            apt-get install -y musl-tools
          fi

          echo "CC_x86_64_unknown_linux_musl=musl-gcc" >> "$GITHUB_ENV"
          echo "CC_aarch64_unknown_linux_musl=musl-gcc" >> "$GITHUB_ENV"
          echo "CARGO_TARGET_AARCH64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc" >> "$GITHUB_ENV"
`;

const dispatchSteps = `      - name: Dispatch npm publish workflow
        run: gh workflow run "Publish npm Packages" --repo "\${{ github.repository }}" -f tag="\${{ needs.plan.outputs.tag }}"
      - name: Dispatch static Pages deploy workflow
        run: gh workflow run "Deploy Static Page" --repo "\${{ github.repository }}" -f tag="\${{ needs.plan.outputs.tag }}"
      - name: Dispatch GHCR image publish workflow
        run: gh workflow run "Publish GHCR Image" --repo "\${{ github.repository }}" -f ref="\${{ needs.plan.outputs.tag }}"
`;
const legacyLinuxDepsStepPattern =
  /      - name: Install Linux keyring build dependencies\n        if: \$\{\{ runner\.os == 'Linux' \}\}\n        run: \|\n(?:          .+\n)+/;

let source = fs.readFileSync(workflowPath, "utf8");

source = source.replace(legacyLinuxDepsStepPattern, "");
source = source.replace(
  `          sudo apt-get update
          sudo apt-get install -y musl-tools
`,
  `          if command -v sudo >/dev/null 2>&1; then
            sudo apt-get update
            sudo apt-get install -y musl-tools
          else
            apt-get update
            apt-get install -y musl-tools
          fi
`,
);

if (source.includes(permissionsBlock) && !source.includes(`  "actions": "write"`)) {
  source = source.replace(permissionsBlock, expandedPermissionsBlock);
}

if (!source.includes(insertAfter) || !source.includes(buildMarker)) {
  throw new Error(`release workflow structure changed: ${workflowPath}`);
}

if (!source.includes(wixStepName)) {
  source = source.replace(
    `${insertAfter}${buildMarker}`,
    `${insertAfter}${wixStep}${buildMarker}`,
  );
}

if (source.includes(muslStepName)) {
  source = source.replace(muslStepPattern, muslStep);
} else {
  source = source.replace(insertAfter, `${insertAfter}${muslStep}`);
}

source = source.replace(dispatchStepPattern, "");

const announceStart = source.indexOf(announceSectionMarker);
if (announceStart === -1) {
  throw new Error(`announce workflow structure changed: ${workflowPath}`);
}

const announceSection = source.slice(announceStart);
const announceCheckoutOffset = announceSection.indexOf(announceCheckoutMarker);
if (announceCheckoutOffset === -1) {
  throw new Error(`announce checkout block changed: ${workflowPath}`);
}

const announceInsertIndex =
  announceStart + announceCheckoutOffset + announceCheckoutMarker.length;
const normalizedAnnounceSection = source.slice(announceStart);

if (!normalizedAnnounceSection.includes(dispatchStepName)) {
  source = `${source.slice(0, announceInsertIndex)}${dispatchSteps}${source.slice(announceInsertIndex)}`;
}

fs.writeFileSync(workflowPath, source);
