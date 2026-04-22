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

面向 AI Agent 的 GPT Image 2 CLI 与 Skill。一个命令面同时支持 `OPENAI_API_KEY`、OpenAI-compatible `--openai-api-base`，以及 Codex `~/.codex/auth.json` 图片链路。

## 功能特性

- `images generate`、`images edit`、`request create`
- OpenAI `gpt-image-2` 与兼容服务端，支持自定义 `--openai-api-base`
- Codex `auth.json` 图片链路，默认模型 `gpt-5.4`
- `-m/--model`、`--ref-image`、`--mask`、`--background transparent`
- `--format png|jpeg|webp`、`--quality`、`--compression`、`--input-fidelity`
- `--json` stdout 结果与 `--json-events` stderr JSONL 进度事件
- 默认 3 次 retry，Codex `401` 自动 refresh 后重试
- `2K`、`4K` 尺寸别名与自定义 `WIDTHxHEIGHT`

## 安装

```bash
cargo install gpt-image-2-skill --locked
cargo binstall gpt-image-2-skill --no-confirm
brew install wangnov/tap/gpt-image-2-skill
npm install --global gpt-image-2-skill
```

本地开发安装：

```bash
make install-local
```

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

Codex `auth.json` 生图：

```bash
gpt-image-2-skill --json --json-events \
  --provider codex \
  images generate \
  --prompt "A glossy red apple sticker on transparent background" \
  --out ./apple.png
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

```bash
npx skills add https://github.com/Wangnov/gpt-image-2-skill --skill gpt-image-2-skill
```

Skill 入口是 `node skills/gpt-image-2-skill/scripts/gpt_image_2_skill.cjs`。包装器按这个顺序解析运行时：

1. `GPT_IMAGE_2_SKILL_BIN`
2. 已安装的 `gpt-image-2-skill`
3. 仓库内 `cargo run -p gpt-image-2-skill --`
4. 当前版本 GitHub Release 资产下载到本地缓存

## 尺寸与输出

- `--size 2K` 解析为 `2048x2048`
- `--size 4K` 解析为 `3840x2160`
- 竖版 4K 使用 `2160x3840`
- 当前方图高分辨率上限是 `2880x2880`
- 自定义尺寸遵循当前约束：宽高都是 16 的倍数，最大边长 `3840`，最大总像素 `8294400`，最大长宽比 `3:1`

## 分发与发布

- crates.io：`cargo install gpt-image-2-skill --locked`
- cargo-binstall：预编译二进制安装
- GitHub Releases：归档、shell installer、PowerShell installer、Windows MSI
- Homebrew：`wangnov/tap/gpt-image-2-skill`
- npm：根包 + 平台子包矩阵
- Skill：`npx skills add`

npm 首发通过 GitHub Actions 中的 `NPM_TOKEN` 完成，并保留 `--provenance`。包首次上线后，可运行 `scripts/release/configure-npm-trust.sh` 绑定 trusted publisher；脚本会先读取现有配置，重复执行也安全。手动验收可通过 `npm-publish.yml` 的 `dry_run` 输入完成整条 npm 打包链路校验。

## 文档

- 设计与分发：`docs/rust-release-distribution-design.md`
- Skill 说明：`skills/gpt-image-2-skill/SKILL.md`
- Release 流程：`scripts/release/prepare.sh`、`scripts/release/publish.sh`、`scripts/release/verify.sh`
- Skill 冒烟验证：`scripts/smoke_skill_install.cjs`

## 许可证

MIT。详见 `LICENSE`。

---

<a id="english"></a>

**Language: [中文](#gpt-image-2-skill) | English**

Agent-first GPT Image 2 CLI and Skill. One command surface supports `OPENAI_API_KEY`, OpenAI-compatible `--openai-api-base`, and the Codex image path driven by `~/.codex/auth.json`.

## Features

- `images generate`, `images edit`, and `request create`
- OpenAI `gpt-image-2` plus OpenAI-compatible backends through `--openai-api-base`
- Codex `auth.json` image flow with default model `gpt-5.4`
- `-m/--model`, `--ref-image`, `--mask`, transparent backgrounds, and PNG/JPEG/WebP output
- machine-readable stdout JSON plus stderr JSONL progress events
- default three-attempt retry behavior with Codex `401` refresh
- `2K` and `4K` size aliases plus custom `WIDTHxHEIGHT`

## Installation

```bash
cargo install gpt-image-2-skill --locked
cargo binstall gpt-image-2-skill --no-confirm
brew install wangnov/tap/gpt-image-2-skill
npm install --global gpt-image-2-skill
```

Local development install:

```bash
make install-local
```

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

```bash
npx skills add https://github.com/Wangnov/gpt-image-2-skill --skill gpt-image-2-skill
```

The bundled wrapper resolves the runtime in this order:

1. `GPT_IMAGE_2_SKILL_BIN`
2. an installed `gpt-image-2-skill`
3. repo-local `cargo run -p gpt-image-2-skill --`
4. a cached GitHub Release binary for the current version

## Size Rules

- `--size 2K` resolves to `2048x2048`
- `--size 4K` resolves to `3840x2160`
- portrait 4K uses `2160x3840`
- the current square high-resolution ceiling is `2880x2880`
- custom sizes follow the current constraints: both edges must be multiples of 16, max edge `3840`, max total pixels `8294400`, max aspect ratio `3:1`

## Distribution

- crates.io
- cargo-binstall
- GitHub Releases with archives and installers
- Homebrew tap
- npm root package plus platform subpackages
- installable Skill bundle through `npx skills add`

The first npm publish uses `NPM_TOKEN` in GitHub Actions and keeps `--provenance` enabled. Once the packages exist on npm, run `scripts/release/configure-npm-trust.sh` to bind trusted publishers; the script reads the current state first, so reruns are safe. Manual acceptance can use the `dry_run` input on `npm-publish.yml` to validate the full npm packaging path.

## Docs

- Design and distribution: `docs/rust-release-distribution-design.md`
- Skill spec: `skills/gpt-image-2-skill/SKILL.md`
- Release flow: `scripts/release/prepare.sh`, `scripts/release/publish.sh`, `scripts/release/verify.sh`
- Skill smoke test: `scripts/smoke_skill_install.cjs`

## License

MIT. See `LICENSE`.
