const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const TARGETS = [
  { platform: "darwin", arch: "arm64", packageName: "gpt-image-2-skill-darwin-arm64" },
  { platform: "darwin", arch: "x64", packageName: "gpt-image-2-skill-darwin-x64" },
  { platform: "linux", arch: "arm64", packageName: "gpt-image-2-skill-linux-arm64-gnu", libc: "glibc" },
  { platform: "linux", arch: "x64", packageName: "gpt-image-2-skill-linux-x64-gnu", libc: "glibc" },
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

function resolvePackageName() {
  const libc = detectLibc();
  const match = TARGETS.find((target) => {
    if (target.platform !== process.platform) {
      return false;
    }
    if (target.arch !== process.arch) {
      return false;
    }
    if (!target.libc) {
      return true;
    }
    return target.libc === libc;
  });
  if (!match) {
    throw new Error(`unsupported platform: ${process.platform} ${process.arch}`);
  }
  return match.packageName;
}

function resolveBinaryPath() {
  const packageName = resolvePackageName();
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const packageDir = path.dirname(packageJsonPath);
  const binaryName = process.platform === "win32" ? "gpt-image-2-skill.exe" : "gpt-image-2-skill";
  return path.join(packageDir, "bin", binaryName);
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
  resolveBinaryPath,
  runCli,
};
