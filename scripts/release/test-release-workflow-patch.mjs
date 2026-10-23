import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const patcher = new URL("./patch-release-workflow.mjs", import.meta.url);
// Relevant cargo-dist 0.31.0 output before repository-specific patches.
const generated = [
  "on:",
  "  pull_request:",
  "permissions:",
  '  "contents": "write"',
  "jobs:",
  "  plan:",
  "    outputs:",
  "      tag: ${{ !github.event.pull_request && github.ref_name || '' }}",
  "      tag-flag: ${{ !github.event.pull_request && format('--tag={0}', github.ref_name) || '' }}",
  "    steps:",
  "      - name: Install dist",
  "        shell: bash",
  "        run: curl -LsSf https://example.invalid/cargo-dist-installer.sh | sh",
  "      - id: plan",
  "        run: |",
  "          dist ${{ (!github.event.pull_request && format('host --steps=create --tag={0}', github.ref_name)) || 'plan' }} --output-format=json > plan-dist-manifest.json",
  "      - uses: actions/upload-artifact@v6",
  "  build:",
  "    steps:",
  "      - uses: actions/download-artifact@v7",
  "      - name: Install Rust",
  "        run: |",
  "          if ! command -v cargo; then",
  "            curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
  '            echo "$HOME/.cargo/bin" >> $GITHUB_PATH',
  "          fi",
  "      - name: Install dist",
  "        run: ${{ matrix.install_dist.run }}",
  "      - name: Install dependencies",
  "        run: |",
  "          ${{ matrix.packages_install }}",
  "      - name: Build artifacts",
  "        run: dist build",
  "  announce:",
  "    steps:",
  "      - uses: actions/checkout@v6",
  "        with:",
  "          persist-credentials: false",
  "          submodules: recursive",
  "",
].join("\n");

test("regeneration preserves trusted installers, tag handling, and dispatches", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-workflow-patch-"));
  try {
    const file = path.join(dir, "release.yml");
    fs.writeFileSync(file, generated);
    const run = () => execFileSync(process.execPath, [patcher.pathname, file]);
    run();
    const actual = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(actual, /curl.*\|\s*sh|matrix\.install_dist\.run/);
    assert.doesNotMatch(actual, /dist \$\{\{/);
    assert.match(actual, /workflow_dispatch:\n    inputs:\n      tag:/);
    assert.match(actual, /RELEASE_TAG: \$\{\{ inputs.tag \|\| github.ref_name \}\}/);
    assert.match(actual, /--tag="\$RELEASE_TAG"/);
    assert.match(actual, /run: scripts\/release\/install-cargo-dist.sh/);
    assert.match(actual, /run: .\/scripts\/release\/install-cargo-dist.ps1/);
    assert.match(actual, /must include a trusted Rust toolchain/);
    assert.match(actual, /Configure musl toolchain/);
    assert.match(actual, /Refresh WiX path/);
    for (const action of ["checkout", "upload-artifact", "download-artifact"]) {
      assert.match(actual, new RegExp(`uses: actions/${action}@[a-f0-9]{40} # v`));
    }
    for (const workflow of ["npm publish", "static Pages deploy", "GHCR image publish"]) {
      assert.match(actual, new RegExp(`Dispatch ${workflow} workflow`));
    }
    run();
    assert.equal(fs.readFileSync(file, "utf8"), actual, "patching must be idempotent");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
