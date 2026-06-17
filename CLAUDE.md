# gpt-image-2-skill

Rust workspace（`crates/*`）+ Tauri / Web 前端（`apps/gpt-image-2-app`）+ skill 包（`skills/`）。

## 发版（必须两步，缺一不可）

发版是两个**独立**流程，只跑第一步会让桌面 app 的内部更新失效：

1. `just release patch`（或 `minor` / `major`）—— cargo-dist 流程：bump 版本、发布 crates.io、创建 GitHub Release、上传 CLI 安装包。tag push 后自动触发 "Release" workflow。
2. `just release-tauri v<新版本>` —— 手动触发 "Tauri App Release"（`workflow_dispatch`）：构建桌面 app 安装包，并**生成、上传 `latest.json`**（tauri updater manifest）。**不会随 tag 自动触发，必须手动跑。**

Tauri updater 的端点是 `releases/latest/download/latest.json`（见 `apps/gpt-image-2-app/src-tauri/tauri.conf.json`）。漏掉第 2 步，最新 Release 里就没有 `latest.json`，已安装的 app 检查更新会报：

> Could not fetch a valid release JSON from the remote

**发版完成判据**：`just release-tauri` 触发的 workflow 跑成功，且对应 Release 的 assets 里能看到 `latest.json`。
