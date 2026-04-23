#!/usr/bin/env node

const path = require("node:path");
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
  console.log(
    JSON.stringify(
      {
        ok: true,
        doctor_ok: doctor.ok === true,
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
