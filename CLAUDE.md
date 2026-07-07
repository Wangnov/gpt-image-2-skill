# gpt-image-2-skill

Rust workspace（`crates/*`）+ Tauri / Web 前端（`apps/gpt-image-2-app`）+ skill 包（`skills/`）。

## 发版（必须两步，缺一不可）

发版是两个**独立**流程，只跑第一步会让桌面 app 的内部更新失效：

1. `just release patch`（或 `minor` / `major`）—— cargo-dist 流程：bump 版本、发布 crates.io、创建 GitHub Release、上传 CLI 安装包。tag push 后自动触发 "Release" workflow。
2. `just release-tauri v<新版本>` —— 手动触发 "Tauri App Release"（`workflow_dispatch`）：构建桌面 app 安装包，并**生成、上传 `latest.json`**（tauri updater manifest）。**不会随 tag 自动触发，必须手动跑。**

   ⚠️ **顺序铁律**：第二步必须等第一步的 "Release" workflow 把 GitHub Release 建好之后再跑。两个流程都会创建同一个 `v<版本>` Release，但 cargo-dist 的 `gh release create` **不幂等**、Tauri 的 `create-release` **幂等**——若第二步抢跑，Tauri 会先把 Release 建出来，导致 cargo-dist 在 "Create GitHub Release" 撞 `already exists`，整个 "Release" workflow 失败（CLI 安装包、npm/GHCR 触发一并丢失）。`just release-tauri` 已内置 `scripts/release/wait-for-release.sh`，会阻塞到 Release 的 assets 出现 cargo-dist 特有的 `dist-manifest.json`（只验"Release 存在"防不住抢建后重试的场景）再 dispatch；若手动 `gh workflow run`，务必自行跑该脚本或确认该 asset 已存在。

Tauri updater 的端点是 `releases/latest/download/latest.json`（见 `apps/gpt-image-2-app/src-tauri/tauri.conf.json`）。漏掉第 2 步，最新 Release 里就没有 `latest.json`，已安装的 app 检查更新会报：

> Could not fetch a valid release JSON from the remote

**发版完成判据**：`just release-tauri` 触发的 workflow 跑成功，且对应 Release 的 assets 里能看到 `latest.json`。
