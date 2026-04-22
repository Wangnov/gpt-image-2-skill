#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
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

function readVersion() {
  const content = fs.readFileSync(CRATE_MANIFEST, "utf8");
  const match = content.match(/^version = "([^"]+)"$/m);
  if (!match) {
    throw new Error(`Unable to determine version from ${CRATE_MANIFEST}`);
  }
  return match[1];
}

function syncVersionConstant(filePath, version) {
  const content = fs.readFileSync(filePath, "utf8");
  if (!/^const VERSION = "([^"]+)";$/m.test(content)) {
    throw new Error(`Unable to update VERSION constant in ${filePath}`);
  }
  const next = content.replace(/^const VERSION = "([^"]+)";$/m, `const VERSION = "${version}";`);
  fs.writeFileSync(filePath, next);
  fs.chmodSync(filePath, 0o755);
}

function main() {
  const version = readVersion();
  syncVersionConstant(SKILL_SCRIPT, version);
  fs.chmodSync(SELFTEST_SCRIPT, 0o755);
  console.log(
    JSON.stringify(
      {
        ok: true,
        version,
        updated: [SKILL_SCRIPT, SELFTEST_SCRIPT],
      },
      null,
      2
    )
  );
}

main();
