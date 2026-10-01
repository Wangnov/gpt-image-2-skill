#!/usr/bin/env bash
set -euo pipefail

image="$(realpath "$1")"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
cd "$scratch"
cp "$image" ./app.AppImage
chmod 755 ./app.AppImage
./app.AppImage --appimage-extract >/dev/null

python3 - <<'PY'
from pathlib import Path
root = Path("squashfs-root")
for name in ["AppRun", "AppRun.wrapped", "usr/bin/gpt-image-2-app"]:
    path = root / name
    mode = path.stat().st_mode & 0o777
    assert mode & 0o005 == 0o005, f"其他用户无法读取并执行 {name}: {mode:o}"
    print(f"{name}: {mode:o}")
for path in root.rglob("*"):
    if path.is_symlink():
        continue
    mode = path.stat().st_mode
    required = 0o005 if path.is_dir() else 0o004
    assert mode & required == required, f"其他用户无法访问 {path}"
PY

set +e
dbus-run-session -- xvfb-run -a timeout --kill-after=5s 15s ./squashfs-root/AppRun >launch.log 2>&1
status=$?
set -e
cat launch.log
if [ "$status" != 124 ]; then
  echo "AppImage 启动后提前退出，退出码：$status" >&2
  exit 1
fi
echo "AppImage 启动检查通过：运行超过 15 秒。"
