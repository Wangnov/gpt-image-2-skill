import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./generate-tauri-updater-manifest.mjs", import.meta.url));
const assets = {
  "darwin-aarch64": "GPT.Image.2_1.0.0_aarch64.app.tar.gz",
  "darwin-x86_64": "GPT.Image.2_1.0.0_x64.app.tar.gz",
  "linux-x86_64": "GPT.Image.2_1.0.0_amd64.AppImage",
  "windows-x86_64": "GPT.Image.2_1.0.0_x64-setup.exe",
};

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "image-updater-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [platform, asset] of Object.entries(assets)) {
    writeFileSync(path.join(dir, `${asset}.sig`), `signature-${platform}\n`);
  }
  const out = path.join(dir, "manifest.json");
  return {
    dir,
    run(args = []) {
      execFileSync(process.execPath, [script, "--version", "1.0.0", "--repo", "owner/repo", "--sig-dir", dir, "--pub-date", "2026-10-23T00:00:00Z", "--out", out, ...args], { stdio: "pipe" });
      return JSON.parse(readFileSync(out, "utf8"));
    },
  };
}

test("the default channel never offers a 13.3+ bundle to existing Mac clients", (t) => {
  const manifest = fixture(t).run();
  assert.deepEqual(Object.keys(manifest.platforms), ["linux-x86_64", "windows-x86_64"]);
  for (const platform of ["darwin-aarch64", "darwin-x86_64"]) {
    assert.equal(manifest.platforms[platform], undefined);
  }
});

test("the modern channel includes all signed platform formats", (t) => {
  const manifest = fixture(t).run(["--channel", "modern"]);
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.pub_date, "2026-10-23T00:00:00Z");
  assert.deepEqual(Object.keys(manifest.platforms), Object.keys(assets));
  for (const [platform, asset] of Object.entries(assets)) {
    assert.equal(manifest.platforms[platform].signature, `signature-${platform}`);
    assert.equal(manifest.platforms[platform].url, `https://github.com/owner/repo/releases/download/v1.0.0/${asset}`);
  }
});

test("explicit legacy has the same safe platform set as the default", (t) => {
  const { run } = fixture(t);
  assert.deepEqual(run(["--channel", "legacy"]), run());
});

test("missing or empty signatures abort generation for a required platform", (t) => {
  const { dir, run } = fixture(t);
  const sig = path.join(dir, `${assets["darwin-aarch64"]}.sig`);
  rmSync(sig);
  assert.throws(() => run(["--channel", "modern"]), /Missing updater signature/);
  assert.ok(run().platforms["windows-x86_64"]);
  writeFileSync(sig, " \n");
  assert.throws(() => run(["--channel", "modern"]), /Empty updater signature/);
});

test("an unknown channel fails instead of silently generating a manifest", (t) => {
  assert.throws(() => fixture(t).run(["--channel", "modren"]), /Unknown updater channel/);
});
