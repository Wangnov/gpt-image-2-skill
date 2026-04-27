#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CRATE_MANIFEST = path.join(ROOT, "crates", "gpt-image-2-skill", "Cargo.toml");
const SKILL_SCRIPT = path.join(
  ROOT,
  "skills",
  "gpt-image-2-skill",
  "scripts",
  "gpt_image_2_skill.cjs"
);
const SELFTEST_SCRIPT = path.join(
  ROOT,
  "skills",
  "gpt-image-2-skill",
  "scripts",
  "selftest.cjs"
);
const APP_PACKAGE_JSON = path.join(ROOT, "apps", "gpt-image-2-app", "package.json");
const APP_PACKAGE_LOCK = path.join(ROOT, "apps", "gpt-image-2-app", "package-lock.json");
const TAURI_CONFIG = path.join(
  ROOT,
  "apps",
  "gpt-image-2-app",
  "src-tauri",
  "tauri.conf.json"
);
const NPM_MATRIX_SCRIPT = path.join(ROOT, "scripts", "npm", "build-matrix.mjs");

function readCargoVersion() {
  const content = fs.readFileSync(CRATE_MANIFEST, "utf8");
  const match = content.match(/^version = "([^"]+)"$/m);
  if (!match) {
    throw new Error(`Unable to determine version from ${CRATE_MANIFEST}`);
  }
  return match[1];
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function updateJsonVersion(filePath, version) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  value.version = version;
  writeJson(filePath, value);
}

function updatePackageLockVersion(filePath, version) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  value.version = version;
  if (value.packages?.[""]) {
    value.packages[""].version = version;
  }
  writeJson(filePath, value);
}

function updateTauriVersion(filePath, version) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!/"version"\s*:\s*"([^"]+)"/.test(content)) {
    throw new Error(`Unable to update Tauri version in ${filePath}`);
  }
  const next = content.replace(/("version"\s*:\s*)"([^"]+)"/, `$1"${version}"`);
  fs.writeFileSync(filePath, next);
}

function updateSkillVersion(filePath, version) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!/^const VERSION = "([^"]+)";$/m.test(content)) {
    throw new Error(`Unable to update VERSION constant in ${filePath}`);
  }
  const next = content.replace(/^const VERSION = "([^"]+)";$/m, `const VERSION = "${version}";`);
  fs.writeFileSync(filePath, next);
  fs.chmodSync(filePath, 0o755);
}

function runNpmMatrix(version) {
  execFileSync(process.execPath, [NPM_MATRIX_SCRIPT, "--version", version], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function main() {
  const version = readCargoVersion();
  updateSkillVersion(SKILL_SCRIPT, version);
  fs.chmodSync(SELFTEST_SCRIPT, 0o755);
  updateJsonVersion(APP_PACKAGE_JSON, version);
  updatePackageLockVersion(APP_PACKAGE_LOCK, version);
  updateTauriVersion(TAURI_CONFIG, version);
  runNpmMatrix(version);
  console.log(
    JSON.stringify(
      {
        ok: true,
        version,
        updated: [
          SKILL_SCRIPT,
          SELFTEST_SCRIPT,
          APP_PACKAGE_JSON,
          APP_PACKAGE_LOCK,
          TAURI_CONFIG,
          "packages/npm/*/package.json",
        ],
      },
      null,
      2
    )
  );
}

main();
