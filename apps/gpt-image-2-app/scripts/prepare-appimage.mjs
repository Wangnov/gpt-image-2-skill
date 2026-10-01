import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Tauri 2.11.4 给下载的 AppRun 设置 0770；linuxdeploy 将它原样复制为
// AppRun.wrapped，导致与构建者 UID/GID 不同的用户无法启动 AppImage。
// 预置同一个上游文件，并在打包前设置适合分发的权限。
const digests = {
  x86_64: "f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f",
  aarch64: "072f17c0895a85c490282fe5395c5007e5fc75da727e553b3b8fb680feb11578",
  i686: "a573a682b1a4a3e9b5dddbd1f5785749b7bba6013149b51ae99d0f123fe11691",
  armhf: "b14d89f0762bcf09fc6af2359d936675928b8833ff52a1aeda68cb28a309f6ba",
};
const arch = process.env.TAURI_ENV_ARCH;
const digest = digests[arch];
if (!digest) throw new Error(`不支持的 AppImage 架构：${arch}`);
const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "tauri");
const destination = join(cache, `AppRun-${arch}`);
let bytes;
if (existsSync(destination)) {
  bytes = readFileSync(destination);
} else {
  const response = await fetch(
    `https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-${arch}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok) throw new Error(`下载 AppRun 失败：HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash("sha256").update(bytes).digest("hex") !== digest) {
  throw new Error(`AppRun 校验失败：${destination}`);
}
mkdirSync(cache, { recursive: true });
writeFileSync(destination, bytes);
chmodSync(destination, 0o755);
console.log(`AppImage 启动器已校验，权限已设置为 0755：${destination}`);
