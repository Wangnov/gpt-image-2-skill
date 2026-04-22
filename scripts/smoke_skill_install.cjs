#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SKILL_NAME = "gpt-image-2-skill";
const LOCAL_BINARY = path.join(
  ROOT,
  "target",
  "debug",
  process.platform === "win32" ? "gpt-image-2-skill.exe" : "gpt-image-2-skill"
);

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout?.trim(),
        result.stderr?.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
  return result;
}

function ensureFile(filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Missing installed skill file: ${filePath}`);
  }
}

function main() {
  run("cargo", ["build", "-p", SKILL_NAME], { cwd: ROOT });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${SKILL_NAME}-`));
  try {
    const install = run(
      "npx",
      ["--yes", "skills", "add", ROOT, "--skill", SKILL_NAME, "-y", "--copy"],
      { cwd: tempDir }
    );

    const installedSkill = path.join(tempDir, ".agents", "skills", SKILL_NAME);
    ensureFile(path.join(installedSkill, "SKILL.md"));
    ensureFile(path.join(installedSkill, "agents", "openai.yaml"));
    ensureFile(path.join(installedSkill, "scripts", "gpt_image_2_skill.cjs"));
    ensureFile(path.join(installedSkill, "scripts", "selftest.cjs"));

    const env = { ...process.env, GPT_IMAGE_2_SKILL_BIN: LOCAL_BINARY };
    const selftest = run(
      process.execPath,
      [path.join(installedSkill, "scripts", "selftest.cjs")],
      { cwd: tempDir, env }
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          source: ROOT,
          installed_skill: installedSkill,
          binary: LOCAL_BINARY,
          install_stdout: install.stdout,
          selftest: JSON.parse(selftest.stdout),
        },
        null,
        2
      )
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
