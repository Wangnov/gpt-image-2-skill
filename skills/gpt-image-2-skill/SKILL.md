---
name: gpt-image-2-skill
description: This skill should be used when the user asks to "generate an image", "create a logo", "draw an icon", "edit this photo", "change background to transparent", "remove background", "use GPT image", "use Codex to draw", "用 GPT image 生成图片", "用 Codex 画图", "帮我生成一张图", "改成透明背景", "把这张图编辑一下", or any prompt-to-image or reference-image-edit task that benefits from a structured CLI returning JSON results and JSONL progress events. Supports OpenAI `gpt-image-2` (via `OPENAI_API_KEY` or OpenAI-compatible base URL) and Codex `image_generation` (via `~/.codex/auth.json`) under one command surface, with masks, custom sizes up to 4K, transparent backgrounds, and a raw request escape hatch.
---

Run image generation and editing through one CLI surface that hides provider differences. The Node wrapper at `scripts/gpt_image_2_skill.cjs` resolves an underlying Rust binary (env override → installed binary → repo `cargo run` → cached release → bootstrap download) and forwards every flag.

## When to use this skill

- Generate or edit an image and capture a structured result an agent can parse.
- Switch between `OPENAI_API_KEY`, an OpenAI-compatible base URL, and Codex `auth.json` without changing command shape.
- Need transparent backgrounds, masks, custom sizes up to 4K, or raw request bodies.
- Want live progress events (retries, multipart prep, Codex SSE) on stderr while the final JSON lands on stdout.

## Quick start

Always pass `--json` so the result is machine-readable. Add `--json-events` when progress visibility matters.

```bash
# 1. Confirm runtime + provider readiness
node scripts/gpt_image_2_skill.cjs --json doctor
node scripts/gpt_image_2_skill.cjs --json auth inspect

# 2. Generate (auto-selects provider; OpenAI first, then Codex)
node scripts/gpt_image_2_skill.cjs --json --json-events \
  images generate --prompt "..." --out /tmp/out.png \
  --background transparent --format png --size 2K

# 3. Edit a reference image (OpenAI multipart)
node scripts/gpt_image_2_skill.cjs --json --json-events \
  images edit --prompt "..." --ref-image /tmp/in.png --out /tmp/out.png

# 4. Raw request escape hatch
node scripts/gpt_image_2_skill.cjs --json \
  request create --request-operation generate \
  --body-file /tmp/body.json --out-image /tmp/out.png --expect-image

# 5. Self-test (calls doctor + auth inspect)
node scripts/selftest.cjs
```

Force a provider with `--provider openai`, `--provider codex`, or leave the default `--provider auto`. Override the OpenAI base URL with `--openai-api-base https://...`.

## Flags vs prompt — what each controls

Output **properties** (not "what to draw") are flag-controlled. Putting them in the prompt is unreliable and provider-dependent.

| Property | Use this flag, not the prompt |
|---|---|
| Output background (transparent / opaque / auto) | `--background auto\|transparent\|opaque` |
| Output dimensions | `--size 2K`, `--size 4K`, or `--size WIDTHxHEIGHT` |
| Output container | `--format png\|jpeg\|webp` |
| Compression level | `--compression 0..100` |
| Render quality | `--quality low\|medium\|high\|auto` |
| Number of images | `--n <count>` (OpenAI only) |
| Edit mask region | `--mask <png>` (OpenAI only) |

The prompt is for "what is in the picture"; background, size, format, count, and mask are not. For example, to turn a transparent PNG into a white-background PNG, pass `--background opaque` — describing "white background" only in the prompt is **not reliable**.

**Provider asymmetry**: `--background`, `--n`, `--moderation`, `--mask`, and `--input-fidelity` are honored only by OpenAI (and OpenAI-compatible bases that proxy them). Codex `image_generation` does not honor `--background`; the runtime accepts the flag but the upstream tool drops it. The other four return `code: "unsupported_option"` if passed with `--provider codex`.

## Notes

- `openai` defaults to `gpt-image-2`; `codex` defaults to `gpt-5.4` and delegates to `image_generation`.
- Shared options actually honored everywhere: `--size`, `--quality`, `--format`, `--compression`.
- OpenAI-only options: `--background`, `--n`, `--moderation`, `--mask`, `--input-fidelity`.
- Retries: up to 3 with exponential backoff (1s → 2s → 4s). Codex `401` triggers one token refresh + one retry.
- Size aliases: `2K` → `2048x2048`, `4K` → `3840x2160`. Custom `WxH` requires both edges multiples of 16, max edge 3840, max 8,294,400 pixels, max aspect ratio 3:1.

## Reference files

Load on demand for deeper detail:

- `references/providers.md` — OpenAI / OpenAI-compatible / Codex selection, auth sources, runtime resolution order.
- `references/sizes-and-formats.md` — size aliases, custom constraints, format/quality/compression/background, shared vs OpenAI-only flags.
- `references/json-output.md` — `--json` stdout schema, success and error envelopes, per-command shapes.
- `references/json-events.md` — `--json-events` JSONL phases (`request_started`, `multipart_prepared`, `retry_scheduled`) and Codex SSE passthrough.
- `references/troubleshooting.md` — `runtime_unavailable`, `auth_missing`, Codex `401` refresh, retry policy, size rejections, moderation, timeouts.

## Codex compatibility

The companion file `agents/openai.yaml` is read by Codex Skill runtime only (Claude Code ignores it). Both runtimes execute the commands above with `cwd` at the skill directory, so relative paths like `scripts/gpt_image_2_skill.cjs` resolve in either harness.
