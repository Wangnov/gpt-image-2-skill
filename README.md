# gpt-image-2-skill

<p align="center">
  <img src="https://raw.githubusercontent.com/Wangnov/gpt-image-2-skill/main/assets/logo.png" width="160" alt="gpt-image-2-skill logo">
</p>

[![GitHub Release](https://img.shields.io/github/v/release/Wangnov/gpt-image-2-skill)](https://github.com/Wangnov/gpt-image-2-skill/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Wangnov/gpt-image-2-skill/release-candidate.yml?branch=main&label=release-candidate)](https://github.com/Wangnov/gpt-image-2-skill/actions/workflows/release-candidate.yml)
[![License](https://img.shields.io/github/license/Wangnov/gpt-image-2-skill)](https://github.com/Wangnov/gpt-image-2-skill/blob/main/LICENSE)
[![Rust](https://img.shields.io/badge/Rust-1.88%2B-orange?logo=rust)](https://www.rust-lang.org/)
[![npm](https://img.shields.io/badge/npm-package-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/gpt-image-2-skill)
[![Homebrew](https://img.shields.io/badge/Homebrew-tap-FBB040?logo=homebrew&logoColor=black)](https://github.com/Wangnov/homebrew-tap)

**Language: 中文 | [English](#english)**

面向 AI Agent 和桌面用户的 GPT Image 2 CLI、Tauri App 与 Skill。一个运行核心同时支持 `OPENAI_API_KEY`、OpenAI-compatible `--openai-api-base`，以及 Codex `~/.codex/auth.json` 图片链路。CLI、Tauri App 与 Skill 共用 `$CODEX_HOME/gpt-image-2-skill/config.json`。

## 功能特性

- `images generate`、`images edit`、`transparent generate/extract/verify`、`request create`
- OpenAI `gpt-image-2` 与兼容服务端，支持自定义 `--openai-api-base`
- Codex `auth.json` 图片链路，默认模型 `gpt-5.4`
- `-m/--model`、`--ref-image`、`--mask`、透明 PNG 本地抠图与验证
- `--format png|jpeg|webp`、`--quality`、`--compression`、`--input-fidelity`
- `--json` stdout 结果与 `--json-events` stderr JSONL 进度事件
- 默认 3 次 retry，Codex `401` 自动 refresh 后重试
- `2K`、`4K` 尺寸别名与自定义 `WIDTHxHEIGHT`
- `config`、`secret`、`history` 命令，覆盖共享配置、文件/env/Keychain 密钥来源和本地 SQLite 历史
- Tauri App 桌面端位于 `apps/gpt-image-2-app`，内置同版本 CLI sidecar，并复用同一套配置、Keychain/env/file 密钥解析与历史记录
- Docker Web 自托管运行时可从同一套 React UI 通过 `/api` 调用 Rust 后端，见 `docs/docker-web.md`

## 安装

### 桌面 App

macOS 用户可以通过 Homebrew Cask 安装桌面 App：

```bash
brew install --cask wangnov/tap/gpt-image-2
```

也可以从 [GitHub Releases](https://github.com/Wangnov/gpt-image-2-skill/releases/latest) 下载对应平台安装包：

- macOS Apple Silicon：`GPT.Image.2_*_aarch64.dmg`
- macOS Intel：`GPT.Image.2_*_x64.dmg`
- Windows：`GPT.Image.2_*_x64-setup.exe`
- Linux：`GPT.Image.2_*_amd64.AppImage`、`*.deb` 或 `*.rpm`

macOS DMG 通过 Developer ID 签名并完成 Apple notarization。桌面 App 会把输出图片、任务元数据和历史记录保存到 `$CODEX_HOME/gpt-image-2-skill/`，默认是 `~/.codex/gpt-image-2-skill/`。

### CLI

```bash
cargo install gpt-image-2-skill --locked
cargo binstall gpt-image-2-skill --no-confirm
brew install wangnov/tap/gpt-image-2-skill
npm install --global gpt-image-2-skill
```

本地开发安装：

```bash
just install-local
```

常用本地任务统一通过 `justfile` 管理，可运行 `just --list` 查看入口。

## 快速开始

OpenAI API Key 直连：

```bash
OPENAI_API_KEY=sk-... gpt-image-2-skill --json \
  images generate \
  --prompt "A studio product photo of a red apple on transparent background" \
  --out ./apple.png \
  --background transparent \
  --format png \
  --quality high \
  --size 1024x1024
```

OpenAI-compatible Base URL：

```bash
OPENAI_API_KEY=sk-... gpt-image-2-skill --json \
  --provider openai \
  --openai-api-base https://api.duckcoding.ai/v1 \
  images generate \
  --prompt "A polished geometric app logo on transparent background" \
  --out ./logo.png \
  --background transparent \
  --format png \
  --size 2K
```

共享配置固定 provider：

```bash
gpt-image-2-skill --json config add-provider \
  --name my-image-api \
  --type openai-compatible \
  --api-base https://example.com/v1 \
  --api-key sk-... \
  --set-default

gpt-image-2-skill --json config inspect
gpt-image-2-skill --json images generate \
  --prompt "A polished geometric app logo on transparent background" \
  --out ./logo.png
```

Codex `auth.json` 生图：

```bash
gpt-image-2-skill --json --json-events \
  --provider codex \
  images generate \
  --prompt "A glossy red apple sticker on transparent background" \
  --out ./apple.png
```

透明 PNG 交付：

```bash
gpt-image-2-skill --json --json-events \
  --provider codex \
  transparent generate \
  --prompt "A glossy red apple sticker, centered, no text, no frame" \
  --out ./apple-transparent.png \
  --size 2K \
  --quality high
```

对于玻璃、流光、烟雾等半透明素材，Agent 可以先生成黑底/白底源图，再用本地双背景抠图：

```bash
gpt-image-2-skill --json \
  transparent extract --method dual \
  --dark-image ./glow-black.png \
  --light-image ./glow-white.png \
  --out ./glow-transparent.png \
  --profile glow \
  --strict
```

交付前可用 profile 化质量门检查真实 alpha、假透明棋盘格、边缘贴边、残留碎点、matte 色污染和透明 RGB 清理：

```bash
gpt-image-2-skill --json \
  transparent verify \
  --input ./glow-transparent.png \
  --profile glow \
  --strict
```

如果素材来自 chroma 纯色底抠图，单独 verify 时要带上原始 matte 才会检查色边残留：

```bash
gpt-image-2-skill --json \
  transparent verify \
  --input ./apple-transparent.png \
  --expected-matte-color '#00ff00' \
  --profile product \
  --strict
```

参考图编辑：

```bash
gpt-image-2-skill --json --json-events \
  images edit \
  --prompt "Refine this logo, keep transparency, and improve visibility on dark backgrounds" \
  --ref-image ./logo.png \
  --out ./logo-edit.png \
  --background transparent \
  --format png \
  --size 1024x1024
```

## Skill 安装

Codex / Anthropic skills CLI：

```bash
npx skills add https://github.com/Wangnov/gpt-image-2-skill --skill gpt-image-2-skill
```

Claude Code（直接复制到本地 skills 目录）：

```bash
git clone https://github.com/Wangnov/gpt-image-2-skill /tmp/gpt-image-2-skill
cp -r /tmp/gpt-image-2-skill/skills/gpt-image-2-skill ~/.claude/skills/
```

Skill 入口是 `node skills/gpt-image-2-skill/scripts/gpt_image_2_skill.cjs`。包装器按这个顺序解析运行时：

1. `GPT_IMAGE_2_SKILL_BIN`
2. 已安装的 `gpt-image-2-skill`
3. Tauri App bundled CLI
4. 仓库内 `cargo run -p gpt-image-2-skill --`
5. 当前版本 GitHub Release 资产下载到本地缓存

## 尺寸与输出

- `--size 2K` 解析为 `2048x2048`
- `--size 4K` 解析为 `3840x2160`
- 竖版 4K 使用 `2160x3840`
- 当前方图高分辨率上限是 `2880x2880`
- 自定义尺寸遵循当前约束：宽高都是 16 的倍数，最大边长 `3840`，最大总像素 `8294400`，最大长宽比 `3:1`

## 分发与发布

- crates.io：`cargo install gpt-image-2-skill --locked`
- cargo-binstall：预编译二进制安装
- GitHub Releases：CLI 归档、shell installer、PowerShell installer、Windows MSI、Tauri App 桌面安装包
- Homebrew：CLI formula `wangnov/tap/gpt-image-2-skill`，桌面 App cask `wangnov/tap/gpt-image-2`
- npm：根包 + 平台子包矩阵
- Skill：`npx skills add`

当前发布链路是：

1. `Release`：cargo-dist 构建 CLI 资产、安装脚本、MSI，并发布 Homebrew formula。
2. `Publish npm Packages`：下载同一个 GitHub Release 的 CLI 资产，发布 npm 根包与平台子包，并验证 cargo-binstall、npm 与 Homebrew formula。
3. `Tauri App Release`：在同一个 tag 上构建并上传 macOS DMG、Windows NSIS、Linux AppImage/deb/rpm。macOS 构建会导入 Developer ID 证书并执行 notarization/staple 验证；正式版会同步更新 Homebrew cask。
4. `Post Release Verify`：默认验证 CLI 分发路径；桌面 App 发布完成后会以 `verify_desktop_cask=true` 补验 Homebrew cask 安装路径。

npm 首发通过 GitHub Actions 中的 `NPM_TOKEN` 完成，并保留 `--provenance`。包首次上线后，可运行 `scripts/release/configure-npm-trust.sh` 绑定 trusted publisher；脚本会先读取现有配置，重复执行也安全。手动验收可通过 `npm-publish.yml` 的 `dry_run` 输入完成整条 npm 打包链路校验。

## 文档

- Skill 说明：`skills/gpt-image-2-skill/SKILL.md`
- Docker Web：`docs/docker-web.md`
- Release 流程：`scripts/release/prepare.sh`、`scripts/release/publish.sh`、`scripts/release/verify.sh`
- 本地任务入口：`justfile`
- Skill 冒烟验证：`scripts/smoke_skill_install.cjs`

## 许可证

MIT。详见 `LICENSE`。

---

<a id="english"></a>

**Language: [中文](#gpt-image-2-skill) | English**

Agent-first and desktop-friendly GPT Image 2 CLI, Tauri App, and Skill. One shared runtime supports `OPENAI_API_KEY`, OpenAI-compatible `--openai-api-base`, and the Codex image path driven by `~/.codex/auth.json`. The CLI, Tauri App, and Skill share `$CODEX_HOME/gpt-image-2-skill/config.json`.

## Features

- `images generate`, `images edit`, and `request create`
- OpenAI `gpt-image-2` plus OpenAI-compatible backends through `--openai-api-base`
- Codex `auth.json` image flow with default model `gpt-5.4`
- `-m/--model`, `--ref-image`, `--mask`, transparent backgrounds, and PNG/JPEG/WebP output
- machine-readable stdout JSON plus stderr JSONL progress events
- default three-attempt retry behavior with Codex `401` refresh
- `2K` and `4K` size aliases plus custom `WIDTHxHEIGHT`
- `config`, `secret`, and `history` commands for shared config, file/env/Keychain credential sources, and local SQLite history
- Tauri desktop app under `apps/gpt-image-2-app`; it bundles the matching CLI sidecar and reuses the same config, Keychain/env/file credential resolution, and local history
- Docker Web self-hosted runtime serves the same React UI through a Rust `/api` backend; see `docs/docker-web.md`

## Installation

### Desktop App

macOS users can install the desktop app through Homebrew Cask:

```bash
brew install --cask wangnov/tap/gpt-image-2
```

You can also download the right installer from [GitHub Releases](https://github.com/Wangnov/gpt-image-2-skill/releases/latest):

- macOS Apple Silicon: `GPT.Image.2_*_aarch64.dmg`
- macOS Intel: `GPT.Image.2_*_x64.dmg`
- Windows: `GPT.Image.2_*_x64-setup.exe`
- Linux: `GPT.Image.2_*_amd64.AppImage`, `*.deb`, or `*.rpm`

macOS DMGs are signed with Developer ID and notarized by Apple. The desktop app stores generated images, task metadata, and history under `$CODEX_HOME/gpt-image-2-skill/`, which defaults to `~/.codex/gpt-image-2-skill/`.

### CLI

```bash
cargo install gpt-image-2-skill --locked
cargo binstall gpt-image-2-skill --no-confirm
brew install wangnov/tap/gpt-image-2-skill
npm install --global gpt-image-2-skill
```

Local development install:

```bash
just install-local
```

Local project tasks are managed through `justfile`; run `just --list` to see the available commands.

## Quickstart

OpenAI API key:

```bash
OPENAI_API_KEY=sk-... gpt-image-2-skill --json \
  images generate \
  --prompt "A studio product photo of a red apple on transparent background" \
  --out ./apple.png \
  --background transparent \
  --format png \
  --quality high \
  --size 1024x1024
```

OpenAI-compatible base URL:

```bash
OPENAI_API_KEY=sk-... gpt-image-2-skill --json \
  --provider openai \
  --openai-api-base https://api.duckcoding.ai/v1 \
  images generate \
  --prompt "A polished geometric app logo on transparent background" \
  --out ./logo.png \
  --background transparent \
  --format png \
  --size 2K
```

Pinned provider through shared config:

```bash
gpt-image-2-skill --json config add-provider \
  --name my-image-api \
  --type openai-compatible \
  --api-base https://example.com/v1 \
  --api-key sk-... \
  --set-default

gpt-image-2-skill --json config inspect
gpt-image-2-skill --json images generate \
  --prompt "A polished geometric app logo on transparent background" \
  --out ./logo.png
```

Codex `auth.json`:

```bash
gpt-image-2-skill --json --json-events \
  --provider codex \
  images generate \
  --prompt "A glossy red apple sticker on transparent background" \
  --out ./apple.png
```

Reference image edit:

```bash
gpt-image-2-skill --json --json-events \
  images edit \
  --prompt "Refine this logo, keep transparency, and improve visibility on dark backgrounds" \
  --ref-image ./logo.png \
  --out ./logo-edit.png \
  --background transparent \
  --format png \
  --size 1024x1024
```

## Skill Install

Codex / Anthropic skills CLI:

```bash
npx skills add https://github.com/Wangnov/gpt-image-2-skill --skill gpt-image-2-skill
```

Claude Code (drop the skill into your local skills directory):

```bash
git clone https://github.com/Wangnov/gpt-image-2-skill /tmp/gpt-image-2-skill
cp -r /tmp/gpt-image-2-skill/skills/gpt-image-2-skill ~/.claude/skills/
```

The bundled wrapper resolves the runtime in this order:

1. `GPT_IMAGE_2_SKILL_BIN`
2. an installed `gpt-image-2-skill`
3. Tauri App bundled CLI
4. repo-local `cargo run -p gpt-image-2-skill --`
5. a cached GitHub Release binary for the current version

## Size Rules

- `--size 2K` resolves to `2048x2048`
- `--size 4K` resolves to `3840x2160`
- portrait 4K uses `2160x3840`
- the current square high-resolution ceiling is `2880x2880`
- custom sizes follow the current constraints: both edges must be multiples of 16, max edge `3840`, max total pixels `8294400`, max aspect ratio `3:1`

## Distribution

- crates.io: `cargo install gpt-image-2-skill --locked`
- cargo-binstall: prebuilt CLI binaries
- GitHub Releases: CLI archives, shell installer, PowerShell installer, Windows MSI, and Tauri desktop installers
- Homebrew: CLI formula `wangnov/tap/gpt-image-2-skill`, desktop app cask `wangnov/tap/gpt-image-2`
- npm: root package plus platform subpackages
- Skill: installable bundle through `npx skills add`

The current release chain is:

1. `Release`: cargo-dist builds CLI assets, installer scripts, MSI packages, and publishes the Homebrew formula.
2. `Publish npm Packages`: downloads CLI assets from the same GitHub Release, publishes the npm root package plus platform packages, and verifies cargo-binstall, npm, and the Homebrew formula.
3. `Tauri App Release`: builds and uploads macOS DMGs, Windows NSIS, and Linux AppImage/deb/rpm on the same tag. macOS jobs import the Developer ID certificate and run notarization plus stapling validation; stable releases also update the Homebrew cask.
4. `Post Release Verify`: verifies CLI distribution paths by default; after the desktop app release completes it reruns with `verify_desktop_cask=true` to verify the Homebrew cask install path.

The first npm publish uses `NPM_TOKEN` in GitHub Actions and keeps `--provenance` enabled. Once the packages exist on npm, run `scripts/release/configure-npm-trust.sh` to bind trusted publishers; the script reads the current state first, so reruns are safe. Manual acceptance can use the `dry_run` input on `npm-publish.yml` to validate the full npm packaging path.

## Docs

- Skill spec: `skills/gpt-image-2-skill/SKILL.md`
- Release flow: `scripts/release/prepare.sh`, `scripts/release/publish.sh`, `scripts/release/verify.sh`
- Local task runner: `justfile`
- Skill smoke test: `scripts/smoke_skill_install.cjs`

## License

MIT. See `LICENSE`.
