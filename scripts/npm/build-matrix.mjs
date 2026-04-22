#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CRATE_MANIFEST = path.join(ROOT, "crates", "gpt-image-2-skill", "Cargo.toml");
const PACKAGES_ROOT = path.join(ROOT, "packages", "npm");
const ROOT_PACKAGE_NAME = "gpt-image-2-skill";
const REPOSITORY = "https://github.com/Wangnov/gpt-image-2-skill";

const TARGETS = [
  {
    target: "aarch64-apple-darwin",
    packageName: "gpt-image-2-skill-darwin-arm64",
    directory: "gpt-image-2-skill-darwin-arm64",
    os: ["darwin"],
    cpu: ["arm64"],
    libc: undefined,
    archiveExtension: ".tar.xz",
    binaryName: "gpt-image-2-skill",
  },
  {
    target: "x86_64-apple-darwin",
    packageName: "gpt-image-2-skill-darwin-x64",
    directory: "gpt-image-2-skill-darwin-x64",
    os: ["darwin"],
    cpu: ["x64"],
    libc: undefined,
    archiveExtension: ".tar.xz",
    binaryName: "gpt-image-2-skill",
  },
  {
    target: "aarch64-unknown-linux-gnu",
    packageName: "gpt-image-2-skill-linux-arm64-gnu",
    directory: "gpt-image-2-skill-linux-arm64-gnu",
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["glibc"],
    archiveExtension: ".tar.xz",
    binaryName: "gpt-image-2-skill",
  },
  {
    target: "x86_64-unknown-linux-gnu",
    packageName: "gpt-image-2-skill-linux-x64-gnu",
    directory: "gpt-image-2-skill-linux-x64-gnu",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["glibc"],
    archiveExtension: ".tar.xz",
    binaryName: "gpt-image-2-skill",
  },
  {
    target: "x86_64-unknown-linux-musl",
    packageName: "gpt-image-2-skill-linux-x64-musl",
    directory: "gpt-image-2-skill-linux-x64-musl",
    os: ["linux"],
    cpu: ["x64"],
    libc: ["musl"],
    archiveExtension: ".tar.xz",
    binaryName: "gpt-image-2-skill",
  },
  {
    target: "aarch64-pc-windows-msvc",
    packageName: "gpt-image-2-skill-windows-arm64-msvc",
    directory: "gpt-image-2-skill-windows-arm64-msvc",
    os: ["win32"],
    cpu: ["arm64"],
    libc: undefined,
    archiveExtension: ".zip",
    binaryName: "gpt-image-2-skill.exe",
  },
  {
    target: "x86_64-pc-windows-msvc",
    packageName: "gpt-image-2-skill-windows-x64-msvc",
    directory: "gpt-image-2-skill-windows-x64-msvc",
    os: ["win32"],
    cpu: ["x64"],
    libc: undefined,
    archiveExtension: ".zip",
    binaryName: "gpt-image-2-skill.exe",
  },
];

function parseArgs(argv) {
  const result = {
    check: false,
    releaseDir: null,
    version: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      result.check = true;
      continue;
    }
    if (arg === "--release-dir") {
      result.releaseDir = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--version") {
      result.version = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function readCargoVersion() {
  const content = fs.readFileSync(CRATE_MANIFEST, "utf8");
  const match = content.match(/^version = "([^"]+)"$/m);
  if (!match) {
    throw new Error(`unable to read version from ${CRATE_MANIFEST}`);
  }
  return match[1];
}

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value);
}

function rootPackageIndex() {
  const targetTable = TARGETS.map((target) => {
    const entries = [
      `platform: ${JSON.stringify(target.os[0])}`,
      `arch: ${JSON.stringify(target.cpu[0])}`,
      `packageName: ${JSON.stringify(target.packageName)}`,
    ];
    if (target.libc?.length) {
      entries.push(`libc: ${JSON.stringify(target.libc[0])}`);
    }
    return `  { ${entries.join(", ")} }`;
  }).join(",\n");
  return `const fs = require("node:fs");\nconst path = require("node:path");\nconst childProcess = require("node:child_process");\n\nconst TARGETS = [\n${targetTable}\n];\n\nfunction detectLibc() {\n  if (process.platform !== "linux") {\n    return null;\n  }\n  if (process.report && typeof process.report.getReport === "function") {\n    const report = process.report.getReport();\n    if (report && report.header && report.header.glibcVersionRuntime) {\n      return "glibc";\n    }\n  }\n  try {\n    return fs.existsSync("/etc/alpine-release") ? "musl" : "glibc";\n  } catch {\n    return "glibc";\n  }\n}\n\nfunction resolvePackageName() {\n  const libc = detectLibc();\n  const match = TARGETS.find((target) => {\n    if (target.platform !== process.platform) {\n      return false;\n    }\n    if (target.arch !== process.arch) {\n      return false;\n    }\n    if (!target.libc) {\n      return true;\n    }\n    return target.libc === libc;\n  });\n  if (!match) {\n    throw new Error(\`unsupported platform: \${process.platform} \${process.arch}\`);\n  }\n  return match.packageName;\n}\n\nfunction resolveBinaryPath() {\n  const packageName = resolvePackageName();\n  const packageJsonPath = require.resolve(\`\${packageName}/package.json\`);\n  const packageDir = path.dirname(packageJsonPath);\n  const binaryName = process.platform === "win32" ? "gpt-image-2-skill.exe" : "gpt-image-2-skill";\n  return path.join(packageDir, "bin", binaryName);\n}\n\nfunction runCli(argv = process.argv.slice(2)) {\n  const binaryPath = resolveBinaryPath();\n  const result = childProcess.spawnSync(binaryPath, argv, { stdio: "inherit" });\n  if (result.error) {\n    throw result.error;\n  }\n  return result.status ?? 1;\n}\n\nmodule.exports = {\n  resolveBinaryPath,\n  runCli,\n};\n`;
}

function rootBinScript() {
  return `#!/usr/bin/env node\nconst { runCli } = require("../index.cjs");\nprocess.exit(runCli(process.argv.slice(2)));\n`;
}

function rootPackageJson(version) {
  return {
    name: ROOT_PACKAGE_NAME,
    version,
    description: "Agent-first GPT Image 2 CLI for OpenAI API keys and Codex auth.",
    license: "MIT",
    homepage: REPOSITORY,
    repository: {
      type: "git",
      url: `${REPOSITORY}.git`,
    },
    engines: {
      node: ">=18",
    },
    files: ["bin", "index.cjs", "README.md"],
    bin: {
      [ROOT_PACKAGE_NAME]: "bin/gpt-image-2-skill.js",
    },
    optionalDependencies: Object.fromEntries(TARGETS.map((target) => [target.packageName, version])),
  };
}

function platformPackageJson(version, target) {
  const value = {
    name: target.packageName,
    version,
    description: `Platform binary for ${ROOT_PACKAGE_NAME} (${target.target}).`,
    license: "MIT",
    homepage: REPOSITORY,
    repository: {
      type: "git",
      url: `${REPOSITORY}.git`,
    },
    files: ["bin", "README.md"],
    os: target.os,
    cpu: target.cpu,
    bin: {
      [ROOT_PACKAGE_NAME]: `bin/${target.binaryName}`,
    },
  };
  if (target.libc?.length) {
    value.libc = target.libc;
  }
  return value;
}

function packageReadme(packageName, extraLine) {
  return `# ${packageName}\n\nPublished from https://github.com/Wangnov/gpt-image-2-skill.\n\n${extraLine}\n`;
}

function findArchive(releaseDir, target) {
  const expectedName = `${ROOT_PACKAGE_NAME}-${target.target}${target.archiveExtension}`;
  const directPath = path.join(releaseDir, expectedName);
  if (fs.existsSync(directPath)) {
    return directPath;
  }
  const candidates = fs.readdirSync(releaseDir)
    .filter((entry) => entry === expectedName)
    .map((entry) => path.join(releaseDir, entry));
  return candidates[0] ?? null;
}

function populatePlatformBinary(releaseDir, target) {
  const archivePath = findArchive(releaseDir, target);
  if (!archivePath) {
    throw new Error(`release archive missing for ${target.target}`);
  }
  const packageDir = path.join(PACKAGES_ROOT, target.directory);
  const binDir = path.join(packageDir, "bin");
  ensureDir(binDir);
  const destination = path.join(binDir, target.binaryName);
  const tempDir = fs.mkdtempSync(path.join(process.cwd(), "gpt-image-2-skill-npm-"));
  const extractDir = path.join(tempDir, "extract");
  ensureDir(extractDir);
  if (archivePath.endsWith(".zip")) {
    execFileSync("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "inherit" });
  }
  const extractedPath = findBinary(extractDir, target.binaryName);
  fs.copyFileSync(extractedPath, destination);
  if (!archivePath.endsWith(".zip")) {
    fs.chmodSync(destination, 0o755);
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function findBinary(rootDir, binaryName) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === binaryName) {
        return entryPath;
      }
    }
  }
  throw new Error(`binary ${binaryName} not found in extracted archive`);
}

function buildPackages({ version, releaseDir, check }) {
  ensureDir(PACKAGES_ROOT);
  const rootPackageDir = path.join(PACKAGES_ROOT, ROOT_PACKAGE_NAME);
  ensureDir(path.join(rootPackageDir, "bin"));
  writeText(path.join(rootPackageDir, "index.cjs"), rootPackageIndex());
  writeText(path.join(rootPackageDir, "bin", "gpt-image-2-skill.js"), rootBinScript());
  fs.chmodSync(path.join(rootPackageDir, "bin", "gpt-image-2-skill.js"), 0o755);
  writeJson(path.join(rootPackageDir, "package.json"), rootPackageJson(version));
  writeText(
    path.join(rootPackageDir, "README.md"),
    packageReadme(ROOT_PACKAGE_NAME, "This package resolves and launches the matching platform package."),
  );

  for (const target of TARGETS) {
    const packageDir = path.join(PACKAGES_ROOT, target.directory);
    ensureDir(packageDir);
    ensureDir(path.join(packageDir, "bin"));
    writeJson(path.join(packageDir, "package.json"), platformPackageJson(version, target));
    writeText(
      path.join(packageDir, "README.md"),
      packageReadme(target.packageName, `This package carries the ${target.target} binary.`),
    );
    if (releaseDir) {
      populatePlatformBinary(releaseDir, target);
    }
  }

  if (check) {
    console.log(JSON.stringify({ ok: true, version, mode: "check", packages: TARGETS.length + 1 }));
    return;
  }
  console.log(JSON.stringify({ ok: true, version, mode: releaseDir ? "with-release-dir" : "manifests-only", packages: TARGETS.length + 1 }));
}

const options = parseArgs(process.argv.slice(2));

buildPackages({
  ...options,
  version: options.version ?? readCargoVersion(),
});
