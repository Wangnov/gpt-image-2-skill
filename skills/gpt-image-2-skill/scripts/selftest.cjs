#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const childProcess = require("node:child_process");

const BASE_DIR = __dirname;
const CLI = path.join(BASE_DIR, "gpt_image_2_skill.cjs");

function runJson(args) {
  const result = childProcess.spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "selftest command failed");
  }
  return JSON.parse(result.stdout);
}

function main() {
  const config = runJson(["--json", "config", "inspect"]);
  const doctor = runJson(["--json", "doctor"]);
  const auth = runJson(["--json", "auth", "inspect"]);
  const models = runJson(["--json", "models", "list"]);
  const supported = models.providers?.openai?.supports || [];
  const image26Ready = ["complexity", "markup", "frame_count", "svg"].every((feature) => supported.includes(feature));
  if (!image26Ready) {
    throw new Error("当前 CLI 缺少 GPT Image 2.6 能力，请构建或安装新版运行时。");
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gpt-image-2-skill-selftest-"));
  const transparentPng = path.join(tempDir, "transparent.png");
  fs.writeFileSync(
    transparentPng,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAHElEQVR4nGNgoBQwwhj/wQhFAizHRMgEyhVQDgB71QIIdIAIkgAAAABJRU5ErkJggg==",
      "base64"
    )
  );
  const transparent = runJson([
    "--json",
    "transparent",
    "verify",
    "--input",
    transparentPng,
    "--strict",
  ]);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(
    JSON.stringify(
      {
        ok: true,
        doctor_ok: doctor.ok === true,
        image_26_ready: image26Ready,
        default_image_model: models.providers?.openai?.default_model ?? null,
        transparent_verify_passed: transparent.passed === true,
        config_file: config.config_file ?? null,
        default_provider: config.config?.default_provider ?? null,
        resolved_provider: doctor.provider_selection?.resolved ?? null,
        auth_openai_ready: auth.providers?.openai?.ready ?? null,
        auth_codex_ready: auth.providers?.codex?.ready ?? null,
        providers: Object.keys(auth.providers || {}).sort(),
      },
      null,
      2
    )
  );
}

main();
