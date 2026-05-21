const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const TARGETS = [
  { platform: "darwin", arch: "arm64", packageName: "gpt-image-2-skill-darwin-arm64" },
  { platform: "darwin", arch: "x64", packageName: "gpt-image-2-skill-darwin-x64" },
  { platform: "linux", arch: "arm64", packageName: "gpt-image-2-skill-linux-arm64-gnu", libc: "glibc", flavor: "gnu" },
  { platform: "linux", arch: "arm64", packageName: "gpt-image-2-skill-linux-arm64-static", flavor: "static" },
  { platform: "linux", arch: "x64", packageName: "gpt-image-2-skill-linux-x64-gnu", libc: "glibc", flavor: "gnu" },
  { platform: "linux", arch: "x64", packageName: "gpt-image-2-skill-linux-x64-static", flavor: "static" },
  { platform: "win32", arch: "arm64", packageName: "gpt-image-2-skill-windows-arm64-msvc" },
  { platform: "win32", arch: "x64", packageName: "gpt-image-2-skill-windows-x64-msvc" }
];

function detectLibc() {
  if (process.platform !== "linux") {
    return null;
  }
  if (process.report && typeof process.report.getReport === "function") {
    const report = process.report.getReport();
    if (report && report.header && report.header.glibcVersionRuntime) {
      return "glibc";
    }
  }
  try {
    return fs.existsSync("/etc/alpine-release") ? "musl" : "glibc";
  } catch {
    return "glibc";
  }
}

function packageMatchesRuntime(target, libc) {
  if (target.platform !== process.platform || target.arch !== process.arch) {
    return false;
  }
  if (process.platform !== "linux") {
    return true;
  }
  if (!target.libc) {
    return true;
  }
  return target.libc === libc;
}

function packagePriority(target, libc) {
  if (process.platform !== "linux") {
    return 0;
  }
  if (target.flavor === "static") {
    return libc === "musl" ? 0 : 1;
  }
  return 0;
}

function candidatePackages() {
  const libc = detectLibc();
  const candidates = TARGETS
    .filter((target) => packageMatchesRuntime(target, libc))
    .sort((left, right) => packagePriority(left, libc) - packagePriority(right, libc));
  if (candidates.length === 0) {
    throw new Error(`unsupported platform: ${process.platform} ${process.arch}`);
  }
  return candidates;
}

function resolveBinaryCandidates() {
  const binaryName = process.platform === "win32" ? "gpt-image-2-skill.exe" : "gpt-image-2-skill";
  const missing = [];
  const candidates = [];
  for (const target of candidatePackages()) {
    try {
      const packageJsonPath = require.resolve(`${target.packageName}/package.json`);
      const packageDir = path.dirname(packageJsonPath);
      candidates.push({
        ...target,
        binaryPath: path.join(packageDir, "bin", binaryName),
      });
    } catch (error) {
      missing.push(`${target.packageName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`No platform package is installed for ${process.platform} ${process.arch}. Tried: ${missing.join("; ")}`);
  }
  return candidates;
}

function isGlibcLoadError(stderr) {
  return /GLIBC_[0-9.]+.*not found|version [`']GLIBC_[^`']+[`'] not found/.test(stderr || "");
}

function probeBinary(binaryPath) {
  const result = childProcess.spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (result.error) {
    return { ok: false, message: result.error.message, stderr: "" };
  }
  if (result.status !== 0) {
    return { ok: false, message: `${binaryPath} --version failed with status ${result.status}`, stderr: result.stderr || "" };
  }
  return { ok: true, message: "", stderr: "" };
}

function resolveBinaryPath() {
  const failures = [];
  for (const candidate of resolveBinaryCandidates()) {
    const probe = probeBinary(candidate.binaryPath);
    if (probe.ok) {
      return candidate.binaryPath;
    }
    failures.push(`${candidate.packageName}: ${probe.stderr || probe.message}`);
    if (candidate.flavor !== "gnu" || !isGlibcLoadError(probe.stderr)) {
      break;
    }
  }
  throw new Error(`No usable gpt-image-2-skill binary found. ${failures.join("; ")}`);
}

function runCli(argv = process.argv.slice(2)) {
  const binaryPath = resolveBinaryPath();
  const result = childProcess.spawnSync(binaryPath, argv, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

module.exports = {
  resolveBinaryCandidates,
  resolveBinaryPath,
  runCli,
};
