#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const CLI_NAME = "gpt-image-2-skill";
const VERSION = "0.2.5";
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

function detectTarget() {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      return { triple: "aarch64-apple-darwin", extension: "" };
    }
    if (process.arch === "x64") {
      return { triple: "x86_64-apple-darwin", extension: "" };
    }
    throw new Error(`Unsupported macOS architecture: ${process.arch}`);
  }
  if (process.platform === "linux") {
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
    if (!arch) {
      throw new Error(`Unsupported Linux architecture: ${process.arch}`);
    }
    return { triple: `${arch}-unknown-linux-${detectLibc()}`, extension: "" };
  }
  if (process.platform === "win32") {
    const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null;
    if (!arch) {
      throw new Error(`Unsupported Windows architecture: ${process.arch}`);
    }
    return { triple: `${arch}-pc-windows-msvc`, extension: ".exe" };
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function cacheBinaryPath(target, extension) {
  return path.join(CACHE_ROOT, target, `${CLI_NAME}${extension}`);
}

function resolveFromCache() {
  const { triple, extension } = detectTarget();
  const candidate = cacheBinaryPath(triple, extension);
  if (!isExecutableFile(candidate)) {
    return null;
  }
  return { argvPrefix: [candidate], cwd: null, source: "cache" };
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

async function downloadArchive(url, archivePath) {
  const response = await fetch(url, {
    headers: {
      "user-agent": `${CLI_NAME}/${VERSION} skill-wrapper`,
    },
  });
  if (!response.ok) {
    throw new Error(`Release asset unavailable: ${url} (HTTP ${response.status})`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(archivePath, bytes);
}

function extractArchive(archivePath, extractDir) {
  const tarBinary = resolveExecutable("tar");
  if (!tarBinary) {
    throw new Error("Archive extraction requires tar in PATH.");
  }
  const result = childProcess.spawnSync(tarBinary, ["-xf", archivePath, "-C", extractDir], {
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Unable to extract ${archivePath}`);
  }
}

async function bootstrapReleaseBinary() {
  if (truthyEnv(SKIP_BOOTSTRAP_ENV)) {
    return null;
  }
  const { triple, extension } = detectTarget();
  const destination = cacheBinaryPath(triple, extension);
  if (isExecutableFile(destination)) {
    return { argvPrefix: [destination], cwd: null, source: "cache" };
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `${CLI_NAME}-bootstrap-`));
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const archiveName = assetName(triple);
    const archivePath = path.join(tempRoot, archiveName);
    await downloadArchive(`${RELEASE_BASE_URL}/${archiveName}`, archivePath);
    const extractDir = path.join(tempRoot, "extract");
    fs.mkdirSync(extractDir, { recursive: true });
    extractArchive(archivePath, extractDir);

    const binaryName = `${CLI_NAME}${extension}`;
    const extractedBinary = findFile(extractDir, binaryName);
    if (!extractedBinary) {
      throw new Error(`Unable to locate ${binaryName} inside ${archiveName}`);
    }
    fs.copyFileSync(extractedBinary, destination);
    if (process.platform !== "win32") {
      fs.chmodSync(destination, 0o755);
    }
    return { argvPrefix: [destination], cwd: null, source: "bootstrap" };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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
  for (const resolver of [resolveFromEnvBinary, resolveFromPath, resolveFromAppBundle, resolveFromRepo, resolveFromCache]) {
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

main().then((code) => {
  process.exit(code);
});
