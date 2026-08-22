#!/usr/bin/env node

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  archiveExtractionArgs,
  downloadArchive,
  downloadReleaseAsset,
  expectedArchiveSha256,
  extractArchive,
} = require("../../skills/gpt-image-2-skill/scripts/gpt_image_2_skill.cjs").__test;

const originalFetch = global.fetch;
const trustedResponseUrl = "https://release-assets.githubusercontent.com/test-asset";

afterEach(() => {
  global.fetch = originalFetch;
});

function response(body, options = {}) {
  const headers = new Headers(options.headers);
  if (options.declareLength !== false) {
    headers.set("content-length", String(Buffer.byteLength(body)));
  }
  const value = new Response(body, { status: options.status ?? 200, headers });
  Object.defineProperty(value, "url", {
    configurable: true,
    value: options.url ?? trustedResponseUrl,
  });
  return value;
}

function mockArchiveFetch(archiveName, archiveBytes, expectedBytes = archiveBytes) {
  const digest = crypto.createHash("sha256").update(expectedBytes).digest("hex");
  global.fetch = async (url) => {
    if (String(url).endsWith(`${archiveName}.sha256`)) {
      return response(`${digest} *${archiveName}\n\n`);
    }
    if (String(url).endsWith(archiveName)) {
      return response(archiveBytes);
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test("accepts a release archive only after its SHA-256 sidecar matches", async () => {
  const archiveName = "gpt-image-2-skill-aarch64-apple-darwin.tar.xz";
  const archiveBytes = Buffer.from("verified archive bytes");
  mockArchiveFetch(archiveName, archiveBytes);

  assert.deepEqual(await downloadArchive(archiveName), archiveBytes);
});

test("rejects a release archive whose bytes do not match the sidecar", async () => {
  const archiveName = "gpt-image-2-skill-aarch64-apple-darwin.tar.xz";
  mockArchiveFetch(
    archiveName,
    Buffer.from("tampered archive bytes"),
    Buffer.from("expected archive bytes")
  );

  await assert.rejects(downloadArchive(archiveName), /SHA-256 verification failed/);
});

test("rejects oversized streamed release assets even without Content-Length", async () => {
  global.fetch = async () => response("1234", { declareLength: false });

  await assert.rejects(
    downloadReleaseAsset("gpt-image-2-skill-aarch64-apple-darwin.tar.xz", 3),
    /3-byte limit/
  );
});

test("rejects release redirects outside the exact GitHub asset hosts", async () => {
  global.fetch = async () => response("data", { url: "https://attacker.example/archive" });

  await assert.rejects(
    downloadReleaseAsset("gpt-image-2-skill-aarch64-apple-darwin.tar.xz", 100),
    /untrusted host/
  );
});

test("rejects a checksum sidecar that names another archive", () => {
  const digest = "a".repeat(64);

  assert.throws(
    () => expectedArchiveSha256(Buffer.from(`${digest} *other.tar.xz\n`), "archive.tar.xz"),
    /Invalid SHA-256 sidecar/
  );
});

test("rejects release asset names outside the supported target matrix", async () => {
  await assert.rejects(downloadReleaseAsset("../archive.tar.xz", 100), /Invalid release asset name/);
});

test("selects explicit xz decompression for streamed tar archives", () => {
  assert.deepEqual(
    archiveExtractionArgs("gpt-image-2-skill-x86_64-unknown-linux-gnu.tar.xz", "/tmp/out"),
    ["-xJf", "-", "-C", "/tmp/out"]
  );
  assert.deepEqual(
    archiveExtractionArgs("gpt-image-2-skill-x86_64-pc-windows-msvc.zip", "/tmp/out"),
    ["-xf", "-", "-C", "/tmp/out"]
  );
});

test("extracts xz archive bytes from stdin", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gpt2-wrapper-xz-test-"));
  const sourceDir = path.join(tempRoot, "source");
  const extractDir = path.join(tempRoot, "extract");
  try {
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(extractDir);
    fs.writeFileSync(path.join(sourceDir, "fixture.txt"), "verified fixture\n");
    const packed = childProcess.spawnSync(
      "tar",
      ["-cJf", "-", "-C", sourceDir, "fixture.txt"],
      { maxBuffer: 1024 * 1024 }
    );
    assert.equal(packed.status, 0, packed.stderr?.toString("utf8"));

    extractArchive(
      packed.stdout,
      "gpt-image-2-skill-x86_64-unknown-linux-gnu.tar.xz",
      extractDir
    );
    assert.equal(fs.readFileSync(path.join(extractDir, "fixture.txt"), "utf8"), "verified fixture\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
