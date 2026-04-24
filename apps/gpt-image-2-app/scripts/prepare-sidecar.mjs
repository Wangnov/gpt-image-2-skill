import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const repoRoot = resolve(appDir, "../..");
const binName = "gpt-image-2-skill";

function parseTarget() {
  const argTargetIndex = process.argv.indexOf("--target");
  if (argTargetIndex >= 0 && process.argv[argTargetIndex + 1]) {
    return process.argv[argTargetIndex + 1];
  }
  return process.env.GPT_IMAGE_2_APP_TARGET || "";
}

const target = parseTarget();
const buildArgs = ["build", "--release", "-p", binName];
if (target) {
  buildArgs.push("--target", target);
}

const build = spawnSync("cargo", buildArgs, {
  cwd: repoRoot,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const isWindowsTarget = target.includes("windows") || process.platform === "win32";
const extension = isWindowsTarget ? ".exe" : "";
const releaseDir = target
  ? join(repoRoot, "target", target, "release")
  : join(repoRoot, "target", "release");
const source = join(releaseDir, `${binName}${extension}`);

if (!existsSync(source)) {
  throw new Error(`Sidecar binary was not built: ${source}`);
}

const destinationDir = join(appDir, "src-tauri", "bin");
const destination = join(destinationDir, `${binName}${extension}`);

rmSync(destinationDir, { recursive: true, force: true });
mkdirSync(destinationDir, { recursive: true });
copyFileSync(source, destination);

if (!isWindowsTarget) {
  chmodSync(destination, 0o755);
}

const isMacTarget = target.includes("apple-darwin") || (!target && process.platform === "darwin");
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;

if (isMacTarget && signingIdentity) {
  const sign = spawnSync(
    "codesign",
    [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--sign",
      signingIdentity,
      destination,
    ],
    {
      stdio: "inherit",
    },
  );

  if (sign.status !== 0) {
    process.exit(sign.status ?? 1);
  }
}

console.log(`Prepared sidecar: ${destination}`);
