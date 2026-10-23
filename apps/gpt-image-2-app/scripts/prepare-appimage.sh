#!/usr/bin/env bash
set -euo pipefail

# Tauri 给下载的 AppRun 设置 0770；linuxdeploy 将其保留为 AppRun.wrapped。
# 校验同一个上游文件后，以 0755 原子替换缓存，保证其他用户可以启动。
case "${TAURI_ENV_ARCH:?}" in
  x86_64) digest=f30140a43a0a59e46db21bdefdf749b9e9f2c6946e92afabbacf98b8ae73fb4f ;;
  aarch64) digest=072f17c0895a85c490282fe5395c5007e5fc75da727e553b3b8fb680feb11578 ;;
  i686) digest=a573a682b1a4a3e9b5dddbd1f5785749b7bba6013149b51ae99d0f123fe11691 ;;
  armhf) digest=b14d89f0762bcf09fc6af2359d936675928b8833ff52a1aeda68cb28a309f6ba ;;
  *) echo "不支持的 AppImage 架构：$TAURI_ENV_ARCH" >&2; exit 1 ;;
esac
cache="${XDG_CACHE_HOME:-$HOME/.cache}/tauri"
filename="AppRun-$TAURI_ENV_ARCH"
mkdir -p "$cache"
scratch="$(mktemp -d "$cache/apprun.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
if [ -f "$cache/$filename" ]; then
  cp "$cache/$filename" "$scratch/$filename"
else
  curl -fsSL --retry 3 --connect-timeout 15 --max-time 60 \
    "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/$filename" \
    -o "$scratch/$filename"
fi
printf '%s  %s\n' "$digest" "$scratch/$filename" | sha256sum --check --status
chmod 755 "$scratch/$filename"
mv -f "$scratch/$filename" "$cache/$filename"
echo "AppImage 启动器已校验，权限已设置为 0755：$cache/$filename"
