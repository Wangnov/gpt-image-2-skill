#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { afterEach, test } = require("node:test");

const {
  downloadArchive,
  downloadReleaseAsset,
  expectedArchiveSha256,
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
