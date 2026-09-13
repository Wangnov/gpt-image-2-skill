---
name: gpt-image-2-skill
description: This skill should be used when the user asks to "generate an image", "create a logo", "draw an icon", "edit this photo", "change background to transparent", "remove background", "use GPT image", "use Codex to draw", "用 GPT image 生成图片", "用 Codex 画图", "帮我生成一张图", "改成透明背景", "把这张图编辑一下", or any prompt-to-image or reference-image-edit task that benefits from a structured CLI returning JSON results and JSONL progress events. Supports OpenAI GPT Image models (via `OPENAI_API_KEY` or OpenAI-compatible base URL) and Codex `image_generation` (via `~/.codex/auth.json`, with an explicit supported orchestration model) under one command surface, with masks, custom sizes up to 4K, transparent backgrounds, and a raw request escape hatch.
---

Run image generation and editing through one CLI surface that hides provider differences. The Node wrapper at `scripts/gpt_image_2_skill.cjs` resolves an underlying Rust binary (env override → bundled Skill binary → installed binary → Tauri App bundled CLI → repo `cargo run` → cached release → bootstrap download) and forwards every flag. On glibc Linux, release bootstrap tries the GNU archive first and then the static musl archive as the sandbox fallback.

## When to use this skill

- Generate or edit an image and capture a structured result an agent can parse.
- Switch between `OPENAI_API_KEY`, an OpenAI-compatible base URL, and Codex `auth.json` without changing command shape.
- Respect shared provider config at `$CODEX_HOME/gpt-image-2-skill/config.json` so CLI, App, and Skill use the same default provider.
- Need final transparent PNG deliverables, masks, custom sizes up to 4K, or raw request bodies.
- Want live progress events (retries, multipart prep, Codex SSE) on stderr while the final JSON lands on stdout.

## Quick start

Always pass `--json` so the result is machine-readable. Add `--json-events` when progress visibility matters.

```bash
# 1. Confirm runtime + provider readiness
node scripts/gpt_image_2_skill.cjs --json config inspect
node scripts/gpt_image_2_skill.cjs --json doctor
node scripts/gpt_image_2_skill.cjs --json auth inspect

# 2. Generate a final transparent PNG deliverable
node scripts/gpt_image_2_skill.cjs --json --json-events \
  transparent generate --prompt "..." --out /tmp/asset.png \
  --size 2K --quality high

# 3. Generate a normal image (auto-selects provider; OpenAI first, then Codex)
node scripts/gpt_image_2_skill.cjs --json --json-events \
  images generate --prompt "..." --out /tmp/out.png \
  --format png --size 2K

# 4. Edit a reference image (OpenAI multipart)
node scripts/gpt_image_2_skill.cjs --json --json-events \
  images edit --prompt "..." --ref-image /tmp/in.png --out /tmp/out.png

# 5. Remove a controlled background from existing source images
node scripts/gpt_image_2_skill.cjs --json \
  transparent extract --input /tmp/source-green.png --out /tmp/asset.png \
  --method chroma --matte-color auto --strict

# 6. Verify the final file before delivery
node scripts/gpt_image_2_skill.cjs --json \
  transparent verify --input /tmp/asset.png --profile icon --strict

# 7. Raw request escape hatch
node scripts/gpt_image_2_skill.cjs --json \
  request create --request-operation generate \
  --body-file /tmp/body.json --out-image /tmp/out.png --expect-image

# 8. Self-test (calls doctor + auth inspect)
node scripts/selftest.cjs
```

Force a provider with `--provider openai`, `--provider codex`, or any named provider from `config inspect`; leave the default `--provider auto` to use `default_provider` first. Override the legacy OpenAI base URL with `--openai-api-base https://...`.

## 本地 Codex 生图（2026-09-09 更新）

以下 CLI 示例走 Responses 路径。复现最新 Codex App 时，应区分宿主原生 `image_gen.imagegen` 的独立 Images 路径；见 `references/codex-native-imagegen.md`。原生工具成功不代表 CLI 已适配，服务端别名也不能证明实际权重版本。

用户指定 Codex 时，必须显式传 `--provider codex`，避免共享配置将请求路由到 OpenAI-compatible 服务。下面的命令从 Skill 目录执行，使用本地 Codex 登录，不需要 OpenAI API key：

```bash
node scripts/gpt_image_2_skill.cjs --json --provider codex doctor
mkdir -p output
node scripts/gpt_image_2_skill.cjs --json --json-events --provider codex \
  images generate --model gpt-6-astra \
  --prompt "一只橙色纸雕小狐狸坐在蓝绿色月牙上，深蓝背景" \
  --out output/codex-fox.png --format png --size 1024x1024 \
  > output/result.json 2> output/events.jsonl
```

- 当前 CLI 的 Codex 默认值仍是 `gpt-5.4`；本地实测已被 ChatGPT 账户后端拒绝。示例显式使用本次验证的 `gpt-6-astra`，其他账户仍需核对可用模型。
- `--model` 是外层调用工具的模型，不能填 `gpt-image-2.5-flare` 或 `gpt-image-2.5-sunburst`。这两个是图像模型 ID。
- 普通命令未指定 `tools[].model`，由 Codex 服务端选择绘图模型。读取 类型为 `response.created` 的 SSE 日志中 `data.response.tools[].model`；不要将 CLI 摘要的 `delegated_image_model` 当作实测结果，该字段在当前版本仍硬编码为 `gpt-image-2`。
- 只有最终 JSON 的 `ok: true`、图片文件真实存在且经过视觉检查，才能报告生图成功。请求被接受或进入 `generating` 不能视为完成。
- HTTP 400 的模型不支持错误应修正模型；不要改用其他 provider。遇到额度、权限或认证错误时报告原因，不自动切到付费 API。
- 对照发现：size 参数本身未保证执行；把尺寸和比例写入提示词曾准确得到1536×1024，冲突时跟随提示词，但4K提示词仍未得到4K。不要按请求值报告实际尺寸。
- 参数并非全无效：output_format确实决定PNG/JPEG；background=opaque压过透明提示词，生成了RGB棋盘格假透明。透明候选应使用auto，并检查真实alpha；quality不能靠提示词保证。
- 关于显式 2.5 请求、服务端返回模型和透明背景限制，见 `references/codex-local-verification.md`。

## Image 2.5 与运行时能力边界

OpenAI 官方已列出 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`，可在 OpenAI Image API 中使用 `--model` 显式选择；这不代表 Codex 订阅后端已支持相同模型选择。保留用户指定的模型和共享配置。

2.5 的公共 API 支持 `xhigh` / `max` 质量和原生透明 PNG/WebP，当前 Rust CLI 与桌面生成界面已支持 `low|medium|high|xhigh|max|auto`；`xhigh/max` 仅用于支持它们的 API 模型，不能保证 Codex 订阅后端支持。Codex 的原始请求操作必须是 `responses`，不能用 `generate`。

官方依据：[Flare](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)、[Sunburst](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)、[图像生成指南](https://developers.openai.com/api/docs/guides/image-generation)。

## 防止静默降级与中文质量验收

- 用户要求Image 2或2.5时，不得为了透明、速度或失败重试自行改用1.5，也不得切换provider掩盖失败。
- 区分请求模型、服务端报告模型、实际权重版本。Codex只返回别名或没有版本字段时，将实际版本标为unknown；不能保证未发生后端回退，也不能仅凭中文表现或透明alpha推断版本。
- 复杂中文须核对原文：常规长句、金额、近形字、生僻字和标点分别检查。2026-09-09新增4张对照中，两条路径均能生成清晰常规中文和真实透明，但均未正确保持“戊戌戍”等辨字及全部生僻字，不能宣称全文准确。
- 最新官方提示词指南已将Image 2透明列为preview，2.5两款均支持透明；“真透明意味着1.5”已不是有效判据。公开API支持不代表Codex订阅路径相同参数必然成功。
- 模型身份不可验证时，不把质量测试包装成身份认证。此处是Skill执行要求，不是已实现的服务端版本锁定功能。

## Runtime freshness check

Before using newly documented command groups, especially `transparent generate`, `transparent extract`, or `transparent verify`, confirm the actual CLI runtime is fresh enough. Skill files, the Tauri App bundle, npm global CLI, cargo-installed CLI, and wrapper cache can drift independently.

Start by checking the latest upstream CLI version:

```bash
npm view gpt-image-2-skill version
```

Then look for the Tauri App bundled CLI first. Treat the app bundle as user-managed software: if it exists but is older than upstream, ask the user before updating or replacing the app.

```bash
APP_CLI="/Applications/GPT Image 2.app/Contents/Resources/bin/gpt-image-2-skill"
[ -x "$APP_CLI" ] && "$APP_CLI" --version
```

If no app bundle CLI exists, check the shell CLI. If it is missing or older than upstream, silently update the CLI dependency with npm, then verify that the current shell resolves the new binary:

```bash
command -v gpt-image-2-skill || true
gpt-image-2-skill --version || true
npm install -g gpt-image-2-skill@latest
command -v gpt-image-2-skill
gpt-image-2-skill --version
```

After any update, run the skill wrapper smoke checks:

```bash
node scripts/gpt_image_2_skill.cjs --json doctor
node scripts/selftest.cjs
```

If a documented subcommand fails with `unrecognized subcommand`, diagnose stale runtime first rather than changing prompts or providers. Prefer the wrapper in this skill directory for reproducible skill execution, but keep the bare CLI fresh when examples or user commands call `gpt-image-2-skill` directly.

## Shared config

Use the CLI config surface when the user asks to add or pin a provider:

```bash
node scripts/gpt_image_2_skill.cjs --json config path
node scripts/gpt_image_2_skill.cjs --json config add-provider \
  --name my-image-api \
  --type openai-compatible \
  --api-base https://example.com/v1 \
  --api-key sk-... \
  --set-default
node scripts/gpt_image_2_skill.cjs --json config test-provider my-image-api
```

Credential sources supported by CLI, App, and Skill: `file`, `env`, and `keychain`. File credentials are stored in the shared config file; JSON output redacts them.

## Flags vs prompt — what each controls

输出属性优先通过接口参数表达，但 Codex 后端可能归一化或忽略参数。提示词可表达期望，最终必须读取实际返回值并检查图片；不要将任何单一参数或提示词视为执行保证。

| Property | CLI flag |
|---|---|
| Output background (transparent / opaque / auto) | `--background auto\|transparent\|opaque` |
| Output dimensions | `--size 2K`, `--size 4K`, or `--size WIDTHxHEIGHT` |
| Output container | `--format png\|jpeg\|webp` |
| Compression level | `--compression 0..100` |
| Render quality | `--quality low\|medium\|high\|auto` |
| Number of images | `--n <count>` (OpenAI only) |
| Edit mask region | `--mask <png>` (OpenAI only) |

提示词用于内容与视觉意图；`--background opaque` 只表达不透明，不指定白色。白背景还需在提示词中明确。对于 Codex，透明提示词配合 `background=auto` 可能得到真实 alpha，而显式透明参数当前可能报错；以实测和文件检查为准。

**Provider asymmetry**: `--n`, `--moderation`, `--mask` 和 `--input-fidelity` 在 Codex 普通命令中返回 `unsupported_option`。`--background` 会写入 Codex 请求，但不能据此保证上游执行；本次原始透明背景请求被后端拒绝。公共 Image API 与 Codex 后端的能力必须分别验证。

## Transparent PNG deliverables

Codex 的显式 `background=transparent` 在本地对照中被拒绝，但 `background=auto` 配合透明提示词曾成功生成真实 RGBA。可以将后者作为候选路径，必须验证 alpha 和严格交付指标；本次样本因全透明区域残留 RGB 未通过严格验收。已合格的原生透明图无需再次抠图。需要本地处理时使用下列流程；OpenAI 2.5 公共 API 的原生透明输出也需同样验收：

- `transparent generate` — prompt-to-final PNG. It generates a controlled matte source, extracts alpha locally, verifies the result, and only succeeds when the final PNG passes transparency checks.
- `transparent extract` — local background removal from controlled source images you generated yourself. It is not a general-purpose background remover for arbitrary photos.
- `transparent verify` — final gate for any PNG before delivery. Use `--strict` and the right `--profile` when the file must be accepted or fail the task.

A transparent deliverable is valid only if the final file has a real PNG alpha channel and passes verification. A visual appearance of transparency, a white background, or a checkerboard pattern is not sufficient.

`--strict` is profile-based:

| Profile | Use for | Extra strictness |
|---|---|---|
| `generic` | common alpha/file checks | does not over-police unusual assets |
| `icon` | clean single-subject icons and props | requires clean opaque core, margin, low stray noise |
| `product` | product/object cutouts | similar to icon, with residue and edge checks |
| `sticker` | decals, badges, multi-detail props | allows more intentional small components than `icon` |
| `seal` | stamps, seals, logos with inner marks | allows split components such as ring + center symbol |
| `translucent` | glass, liquid, crystal | requires partial alpha |
| `glow` | light ribbons, flame, smoke, particles | requires partial alpha and transparent margin |
| `shadow` | soft shadow assets | requires partial alpha and transparent margin |
| `effect` | hard-alpha particles, bursts, UI effects | transparent margin without requiring partial alpha |

The CLI is intentionally not a material classifier. The Agent should choose generation prompts and extraction methods based on the asset:

| Asset type | Generation guidance | Extraction guidance |
|---|---|---|
| Opaque object, icon, sticker, product | Single isolated subject, clear margin, perfectly flat chroma matte. Pick a matte color absent from the object. | `transparent generate` or `transparent extract --method chroma --matte-color auto` |
| Thin edges, hair, fur, lace, chain, netting | Use high resolution, strong subject/background contrast, no contact shadow, no background-colored details. Try magenta/cyan/green mattes if one contaminates the edge. | Chroma extraction with `--spill-suppression` when needed, then verify with `--expected-matte-color`; retry with a different matte if residue remains. |
| Glass, crystal, liquid, hologram | Ask for a centered asset on flat black and flat white backgrounds, keeping geometry identical. Use reference/edit flow when possible to keep alignment. | `transparent extract --method dual --dark-image black.png --light-image white.png` |
| Glow, flame, smoke, mist, magic particles | Generate dark and light background variants. Avoid textured backgrounds and avoid bloom reaching the image edge unless the edge is intentional. | Prefer dual extraction; verify that `partial_pixels` is non-zero. |
| Shadows | Decide whether the shadow is part of the asset. If not, explicitly forbid contact shadows. If yes, generate on a flat matte with enough margin. | Chroma for opaque shadow silhouettes; dual extraction for soft translucent shadows. |
| Unknown or unusual material | Do not classify it first. Generate controlled source variants, run extraction candidates, and keep the one that passes verification with the cleanest edge. | Use `--report-dir` / `--keep-sources` while iterating, then deliver only the final PNG. |

For chroma extraction, `--matte-color auto` samples the actual flat source background from the image edges. Prefer it when the source was AI-generated, because prompts like "pure #ff00ff" often produce near-matte colors rather than exact RGB values. Use explicit `--matte-color <name|#rrggbb>` only when the source background is known exactly.

For extraction tuning, use `--material` only as a broad hint, not as a subject classifier: `standard`, `soft-3d`, `flat-icon`, `sticker`, or `glow`. Manual `--threshold`, `--softness`, and `--spill-suppression` override the selected preset.

For style-locked transparent assets, `transparent generate` is prompt-only. Use a flat RGB reference image with `images edit --ref-image` to create a controlled matte source, then run `transparent extract`. Do not use a transparent PNG as the reference image unless you intentionally want the alpha/composited edge behavior to influence the edit.

GPT Image 2 can render accurate UI text, numbers, scores, labels, and logo marks in the bitmap when they are part of the desired artwork. Put the exact wording or numbering in the prompt and verify the output visually. Render text separately in the host app or design tool only when it must stay editable, localizable, programmatically changeable, or perfectly consistent across many generated variants.

Examples:

```bash
# Simple asset: final transparent PNG, sources hidden unless there is a failure
node scripts/gpt_image_2_skill.cjs --json --json-events \
  transparent generate \
  --prompt "a polished fantasy sword game asset, no text, no frame" \
  --out /tmp/sword.png --size 2K --quality high

# Agent-controlled chroma flow
node scripts/gpt_image_2_skill.cjs --json --json-events \
  images generate \
  --prompt "a silver necklace, centered, on a perfectly flat pure magenta background, no shadow" \
  --out /tmp/necklace-magenta.png --format png --size 2K
node scripts/gpt_image_2_skill.cjs --json \
  transparent extract --method chroma \
  --input /tmp/necklace-magenta.png --matte-color auto \
  --out /tmp/necklace.png --material sticker --strict

# Semi-transparent material flow
node scripts/gpt_image_2_skill.cjs --json \
  transparent extract --method dual \
  --dark-image /tmp/glow-on-black.png \
  --light-image /tmp/glow-on-white.png \
  --out /tmp/glow.png --strict
```

Always inspect the JSON verification fields before delivery: `passed`, `alpha_min`, `alpha_max`, `transparent_ratio`, `partial_pixels`, and `warnings`. Also inspect quality fields: `checkerboard_detected`, `touches_edge`, `edge_margin_px`, `stray_pixel_count`, `largest_component_ratio`, `matte_residue_checked`, `matte_residue_score`, `halo_score`, `transparent_rgb_scrubbed`, `alpha_health_score`, `residue_score`, `quality_score`, and `failure_reasons`. If `passed` is false, do not deliver the file as a transparent PNG. If `matte_residue_checked` is false for a chroma-derived PNG, run `transparent verify` again with the source matte via `--expected-matte-color`.

## Notes

- 当前运行时默认值仍是 OpenAI `gpt-image-2` / Codex `gpt-5.4`；Codex 使用上面的显式模型示例，不能依赖旧默认值。
- 共同接受的 CLI 参数：`--size`、`--quality`、`--format`、`--compression`；Codex 服务端可能归一化这些参数，应核对返回值和实际文件。
- OpenAI-only options: `--n`, `--moderation`, `--mask`, `--input-fidelity`; Codex background behavior requires separate verification.
- Retries: up to 3 with exponential backoff (1s → 2s → 4s). Codex `401` triggers one token refresh + one retry.
- Size aliases: `2K` → `2048x2048`, `4K` → `3840x2160`. Custom `WxH` requires both edges multiples of 16, max edge 3840, max 8,294,400 pixels, max aspect ratio 3:1.

## Reference files

Load on demand for deeper detail:

- `references/codex-native-imagegen.md` — App 原生工具、独立 Images 端点与旧 CLI 调用路径的区别。
- `references/codex-local-verification.md` — 本地 Codex 生图命令、实测结果与模型识别边界。
- `references/providers.md` — OpenAI / OpenAI-compatible / Codex selection, auth sources, runtime discovery, update policy, and resolution order.
- `references/sizes-and-formats.md` — size aliases, custom constraints, format/quality/compression/background, shared vs OpenAI-only flags.
- `references/transparent-png.md` — Agent playbook for prompt design, controlled mattes, dual-background extraction, verification, and retry loops.
- `references/json-output.md` — `--json` stdout schema, success and error envelopes, per-command shapes.
- `references/json-events.md` — `--json-events` JSONL phases (`request_started`, `multipart_prepared`, `retry_scheduled`) and Codex SSE passthrough.
- `references/troubleshooting.md` — `runtime_unavailable`, `auth_missing`, Codex `401` refresh, retry policy, size rejections, moderation, timeouts.

## Codex compatibility

The companion file `agents/openai.yaml` is read by Codex Skill runtime only (Claude Code ignores it). Both runtimes execute the commands above with `cwd` at the skill directory, so relative paths like `scripts/gpt_image_2_skill.cjs` resolve in either harness.
