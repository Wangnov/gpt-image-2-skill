#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const workflowPath = path.join(rootDir, ".github", "workflows", "release.yml");

const marker = "      - name: Build artifacts";
const insertAfter = `      - name: Install dependencies
        run: |
          \${{ matrix.packages_install }}
`;

const injectedStep = `      - name: Refresh WiX path
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

const source = fs.readFileSync(workflowPath, "utf8");
if (source.includes("      - name: Refresh WiX path")) {
  process.exit(0);
}

if (!source.includes(insertAfter) || !source.includes(marker)) {
  throw new Error(`release workflow structure changed: ${workflowPath}`);
}

const updated = source.replace(
  `${insertAfter}${marker}`,
  `${insertAfter}${injectedStep}${marker}`,
);

fs.writeFileSync(workflowPath, updated);
