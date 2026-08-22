#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");

const CLI_NAME = "gpt-image-2-skill";
const VERSION = "0.7.3";
const REPOSITORY = "Wangnov/gpt-image-2-skill";
const RELEASE_BASE_URL = `https://github.com/${REPOSITORY}/releases/download/v${VERSION}`;
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const CACHE_ROOT = path.join(
  process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
  CLI_NAME,
  VERSION
);
const BIN_ENV = "GPT_IMAGE_2_SKILL_BIN";
const APP_BIN_ENV = "GPT_IMAGE_2_SKILL_APP_BIN";
const REPO_ENV = "GPT_IMAGE_2_SKILL_REPO_ROOT";
const SKIP_BOOTSTRAP_ENV = "GPT_IMAGE_2_SKILL_SKIP_BOOTSTRAP";
const SKILL_ROOT = path.resolve(__dirname, "..");
const MAX_RELEASE_ARCHIVE_BYTES = 16 * 1024 * 1024;
const MAX_RELEASE_CHECKSUM_BYTES = 1024;
const RELEASE_ASSET_NAME = /^gpt-image-2-skill-(?:(?:aarch64|x86_64)-apple-darwin\.tar\.xz|(?:aarch64|x86_64)-unknown-linux-(?:gnu|musl)\.tar\.xz|(?:aarch64|x86_64)-pc-windows-msvc\.zip)(?:\.sha256)?$/;
const TRUSTED_RELEASE_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
]);

function wantsJson(argv) {
  return argv.includes("--json");
}

function emitFailure(argv, message, code = "runtime_unavailable", detail = null) {
  if (wantsJson(argv)) {
    const payload = {
      ok: false,
      error: {
        code,
        message,
      },
    };
    if (detail !== null) {
      payload.error.detail = detail;
    }
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  return 1;
}

function truthyEnv(name) {
  const value = (process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isExecutableFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return false;
    }
    if (process.platform === "win32") {
      return true;
    }
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function pathEntries() {
  return (process.env.PATH || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function executableExtensions() {
  if (process.platform !== "win32") {
    return [""];
  }
  return (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveExecutable(name) {
  if (path.isAbsolute(name) || name.includes(path.sep)) {
    return isExecutableFile(name) ? name : null;
  }
  for (const directory of pathEntries()) {
    for (const extension of executableExtensions()) {
      const candidate = path.join(directory, process.platform === "win32" ? `${name}${extension}` : name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function resolveFromEnvBinary() {
  const configured = (process.env[BIN_ENV] || "").trim();
  if (!configured) {
    return null;
  }
  const candidate = path.resolve(configured);
  if (!isExecutableFile(candidate)) {
    return null;
  }
  return { argvPrefix: [candidate], cwd: null, source: "env" };
}

function resolveFromBundledBinary() {
  const binaryName = process.platform === "win32" ? `${CLI_NAME}.exe` : CLI_NAME;
  for (const { triple } of detectTargets()) {
    const candidate = path.join(SKILL_ROOT, "bin", triple, binaryName);
    if (isExecutableFile(candidate)) {
      const runtime = { argvPrefix: [candidate], cwd: null, source: "bundled" };
      if (runtimeSupportsSharedConfig(runtime)) {
        return runtime;
      }
    }
  }
  return null;
}

function resolveFromPath() {
  const binary = resolveExecutable(CLI_NAME);
  if (!binary) {
    return null;
  }
  return { argvPrefix: [binary], cwd: null, source: "path" };
}

function appBundleCandidates() {
  const binaryName = process.platform === "win32" ? `${CLI_NAME}.exe` : CLI_NAME;
  const candidates = [];
  const configured = (process.env[APP_BIN_ENV] || "").trim();
  if (configured) {
    candidates.push(path.resolve(configured));
  }
  if (process.platform === "darwin") {
    candidates.push(
      `/Applications/GPT Image 2.app/Contents/Resources/bin/${binaryName}`,
      path.join(os.homedir(), "Applications", `GPT Image 2.app/Contents/Resources/bin/${binaryName}`)
    );
  } else if (process.platform === "win32") {
    for (const root of [process.env.LOCALAPPDATA, process.env.PROGRAMFILES]) {
      if (root) {
        candidates.push(path.join(root, "GPT Image 2", "resources", "bin", binaryName));
      }
    }
  } else {
    candidates.push(
      `/opt/gpt-image-2/resources/bin/${binaryName}`,
      path.join(os.homedir(), ".local", "share", "gpt-image-2", "bin", binaryName)
    );
  }
  return candidates;
}

function resolveFromAppBundle() {
  for (const candidate of appBundleCandidates()) {
    if (isExecutableFile(candidate)) {
      return { argvPrefix: [candidate], cwd: null, source: "app" };
    }
  }
  return null;
}

function isRepoRoot(candidate) {
  return (
    fs.existsSync(path.join(candidate, "Cargo.toml")) &&
    fs.existsSync(path.join(candidate, "crates", CLI_NAME, "Cargo.toml"))
  );
}

function repoRootCandidate() {
  const configured = (process.env[REPO_ENV] || "").trim();
  if (configured) {
    const candidate = path.resolve(configured);
    if (isRepoRoot(candidate)) {
      return candidate;
    }
  }
  return isRepoRoot(REPO_ROOT) ? REPO_ROOT : null;
}

function resolveFromRepo() {
  const repoRoot = repoRootCandidate();
  if (!repoRoot) {
    return null;
  }
  if (!resolveExecutable("cargo")) {
    return null;
  }
  return {
    argvPrefix: ["cargo", "run", "-q", "-p", CLI_NAME, "--"],
    cwd: repoRoot,
    source: "repo",
  };
}

function detectLibc() {
  if (process.platform !== "linux") {
    return null;
  }
  if (process.report && typeof process.report.getReport === "function") {
    const report = process.report.getReport();
    if (report && report.header && report.header.glibcVersionRuntime) {
      return "gnu";
    }
  }
  return fs.existsSync("/etc/alpine-release") ? "musl" : "gnu";
}

function detectTargets() {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      return [{ triple: "aarch64-apple-darwin", extension: "" }];
    }
    if (process.arch === "x64") {
      return [{ triple: "x86_64-apple-darwin", extension: "" }];
    }
    throw new Error(`Unsupported macOS architecture: ${process.arch}`);
  }
  if (process.platform === "linux") {
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
    if (!arch) {
      throw new Error(`Unsupported Linux architecture: ${process.arch}`);
    }
    const libc = detectLibc();
    const preferred = { triple: `${arch}-unknown-linux-${libc}`, extension: "" };
    if (libc === "gnu") {
      return [preferred, { triple: `${arch}-unknown-linux-musl`, extension: "" }];
    }
    return [preferred];
  }
  if (process.platform === "win32") {
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
    if (!arch) {
      throw new Error(`Unsupported Windows architecture: ${process.arch}`);
    }
    return [{ triple: `${arch}-pc-windows-msvc`, extension: ".exe" }];
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function cacheBinaryPath(target, extension) {
  return path.join(CACHE_ROOT, target, `${CLI_NAME}${extension}`);
}

function resolveFromCache() {
  for (const { triple, extension } of detectTargets()) {
    const candidate = cacheBinaryPath(triple, extension);
    if (!isExecutableFile(candidate)) {
      continue;
    }
    const runtime = { argvPrefix: [candidate], cwd: null, source: "cache" };
    if (runtimeSupportsSharedConfig(runtime)) {
      return runtime;
    }
  }
  return null;
}

function assetName(target) {
  return `${CLI_NAME}-${target}${target.includes("windows") ? ".zip" : ".tar.xz"}`;
}

function findFile(rootDir, fileName) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }
  return null;
}

function releaseAssetUrl(assetName) {
  if (!RELEASE_ASSET_NAME.test(assetName)) {
    throw new Error(`Invalid release asset name: ${assetName}`);
  }
  return `${RELEASE_BASE_URL}/${assetName}`;
}

async function downloadReleaseAsset(assetName, maxBytes) {
  const url = releaseAssetUrl(assetName);
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": `${CLI_NAME}/${VERSION} skill-wrapper`,
    },
  });
  if (!response.ok) {
    throw new Error(`Release asset unavailable: ${url} (HTTP ${response.status})`);
  }

  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== "https:" || !TRUSTED_RELEASE_HOSTS.has(finalUrl.hostname)) {
    throw new Error(`Release asset redirected to an untrusted host: ${finalUrl.hostname}`);
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = /^\d+$/.test(declaredLength) ? Number(declaredLength) : Number.NaN;
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maxBytes) {
      throw new Error(`Release asset exceeds the ${maxBytes}-byte limit: ${assetName}`);
    }
  }

  if (!response.body) {
    throw new Error(`Release asset has no response body: ${assetName}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(`Release asset exceeds the ${maxBytes}-byte limit: ${assetName}`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

function expectedArchiveSha256(checksumBytes, archiveName) {
  const checksum = checksumBytes.toString("utf8").trimEnd();
  const match = /^([a-f0-9]{64}) ([ *])([A-Za-z0-9._-]+)$/.exec(checksum);
  if (!match || match[3] !== archiveName) {
    throw new Error(`Invalid SHA-256 sidecar for ${archiveName}`);
  }
  return match[1];
}

async function downloadArchive(archiveName) {
  const checksumBytes = await downloadReleaseAsset(
    `${archiveName}.sha256`,
    MAX_RELEASE_CHECKSUM_BYTES
  );
  const expected = Buffer.from(expectedArchiveSha256(checksumBytes, archiveName), "hex");
  const bytes = await downloadReleaseAsset(archiveName, MAX_RELEASE_ARCHIVE_BYTES);
  const actual = crypto.createHash("sha256").update(bytes).digest();
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error(`SHA-256 verification failed for ${archiveName}`);
  }
  return bytes;
}

function archiveExtractionArgs(archiveName, extractDir) {
  if (archiveName.endsWith(".tar.xz")) {
    return ["-xJf", "-", "-C", extractDir];
  }
  if (archiveName.endsWith(".zip")) {
    return ["-xf", "-", "-C", extractDir];
  }
  throw new Error(`Unsupported release archive format: ${archiveName}`);
}

function extractArchive(archiveBytes, archiveName, extractDir) {
  const tarBinary = resolveExecutable("tar");
  if (!tarBinary) {
    throw new Error("Archive extraction requires tar in PATH.");
  }
  const result = childProcess.spawnSync(tarBinary, archiveExtractionArgs(archiveName, extractDir), {
    encoding: "utf8",
    input: archiveBytes,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Unable to extract ${archiveName}`);
  }
}

async function bootstrapReleaseBinary() {
  if (truthyEnv(SKIP_BOOTSTRAP_ENV)) {
    return null;
  }
  const errors = [];

  for (const { triple, extension } of detectTargets()) {
    const destination = cacheBinaryPath(triple, extension);
    if (isExecutableFile(destination)) {
      const runtime = { argvPrefix: [destination], cwd: null, source: "cache" };
      if (runtimeSupportsSharedConfig(runtime)) {
        return runtime;
      }
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${CLI_NAME}-bootstrap-`));
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const archiveName = assetName(triple);
      const archiveBytes = await downloadArchive(archiveName);
      const extractDir = path.join(tempRoot, "extract");
      fs.mkdirSync(extractDir, { recursive: true });
      extractArchive(archiveBytes, archiveName, extractDir);

      const binaryName = `${CLI_NAME}${extension}`;
      const extractedBinary = findFile(extractDir, binaryName);
      if (!extractedBinary) {
        throw new Error(`Unable to locate ${binaryName} inside ${archiveName}`);
      }
      fs.copyFileSync(extractedBinary, destination);
      if (process.platform !== "win32") {
        fs.chmodSync(destination, 0o755);
      }
      const runtime = { argvPrefix: [destination], cwd: null, source: "bootstrap" };
      if (runtimeSupportsSharedConfig(runtime)) {
        return runtime;
      }
      errors.push(`${triple}: downloaded runtime failed self-check`);
    } catch (error) {
      errors.push(`${triple}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  throw new Error(`Unable to bootstrap a compatible ${CLI_NAME} runtime. Tried: ${errors.join("; ")}`);
}

function runtimeSupportsSharedConfig(runtime) {
  if (runtime.source === "repo") {
    return true;
  }
  const [command, ...prefixArgs] = runtime.argvPrefix;
  const result = childProcess.spawnSync(command, [...prefixArgs, "--json", "config", "path"], {
    cwd: runtime.cwd || undefined,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    return false;
  }
  try {
    const payload = JSON.parse(result.stdout);
    return payload && payload.ok === true && payload.command === "config path";
  } catch {
    return false;
  }
}

async function resolveRuntime() {
  for (const resolver of [resolveFromEnvBinary, resolveFromBundledBinary, resolveFromPath, resolveFromAppBundle, resolveFromRepo, resolveFromCache]) {
    const runtime = resolver();
    if (runtime && runtimeSupportsSharedConfig(runtime)) {
      return runtime;
    }
  }
  const runtime = await bootstrapReleaseBinary();
  if (runtime && runtimeSupportsSharedConfig(runtime)) {
    return runtime;
  }
  throw new Error(
    "gpt-image-2-skill runtime is unavailable. Install the binary, point GPT_IMAGE_2_SKILL_BIN at it, or publish release assets for this version."
  );
}

async function main(argv = process.argv.slice(2)) {
  try {
    const runtime = await resolveRuntime();
    const [command, ...prefixArgs] = runtime.argvPrefix;
    const result = childProcess.spawnSync(command, [...prefixArgs, ...argv], {
      cwd: runtime.cwd || undefined,
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    return result.status ?? 1;
  } catch (error) {
    return emitFailure(argv, error instanceof Error ? error.message : String(error));
  }
}

if (require.main === module) {
  main().then((code) => {
    process.exit(code);
  });
}

module.exports = {
  __test: {
    archiveExtractionArgs,
    downloadArchive,
    downloadReleaseAsset,
    expectedArchiveSha256,
    extractArchive,
  },
};
