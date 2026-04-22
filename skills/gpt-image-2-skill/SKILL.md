---
name: gpt-image-2-skill
description: Generate or edit images through one installable skill runtime that resolves the local gpt-image-2-skill binary, falls back to a repo-local cargo run during development, and bootstraps a cached GitHub Release binary when needed. Use when an AI agent needs a machine-readable image tool with provider selection, prompt-to-image generation, reference-image edits, masks, structured JSON output, structured progress events, retries, and a raw request escape hatch.
---

Use this skill when:

- an AI agent needs image generation through `OPENAI_API_KEY`
- an AI agent needs image generation through Codex desktop auth
- the caller wants one JSON-first command surface for `openai` and `codex`
- the caller needs reference-image edits, masks, or raw image request bodies

Environment:

- the skill entrypoint is `node {baseDir}/scripts/gpt_image_2_skill.cjs`
- the wrapper prefers `GPT_IMAGE_2_SKILL_BIN`, then an installed `gpt-image-2-skill`, then a repo-local `cargo run`, then a cached GitHub Release binary
- `openai` reads `OPENAI_API_KEY` or `--api-key`
- `codex` reads `~/.codex/auth.json` or `$CODEX_HOME/auth.json`

Behavior:

- JSON-first by default
- `--provider auto` prefers `OPENAI_API_KEY`, then falls back to Codex auth.json
- transient failures retry up to 3 times with exponential backoff
- Codex `401` responses trigger one access-token refresh
- `--json-events` writes provider-agnostic progress events to stderr
- `--json-events` also writes raw Codex SSE events to stderr for live event consumers

Run:

- `node {baseDir}/scripts/gpt_image_2_skill.cjs --json doctor`
- `node {baseDir}/scripts/gpt_image_2_skill.cjs --json auth inspect`
- `node {baseDir}/scripts/gpt_image_2_skill.cjs --json models list`
- `node {baseDir}/scripts/gpt_image_2_skill.cjs --json --json-events images generate --prompt "..." --out /tmp/image.png`
- `node {baseDir}/scripts/gpt_image_2_skill.cjs --json --json-events images edit --prompt "..." --ref-image /tmp/input.png --out /tmp/edit.png`
- `node {baseDir}/scripts/gpt_image_2_skill.cjs --json request create --request-operation generate --body-file /tmp/body.json --out-image /tmp/result.png --expect-image`
- `node {baseDir}/scripts/selftest.cjs`

Notes:

- `openai` uses `gpt-image-2` by default
- `codex` uses `gpt-5.4` by default and delegates image generation through the `image_generation` tool
- shared options include `--background`, `--size`, `--quality`, `--format`, and `--compression`
- `--size 2K` resolves to `2048x2048`
- `--size 4K` resolves to `3840x2160`
- portrait 4K uses `2160x3840`
- the current square high-resolution ceiling is `2880x2880`
- custom `WIDTHxHEIGHT` values follow the current image constraints: both edges are multiples of 16, max edge `3840`, max total pixels `8294400`, max aspect ratio `3:1`
- `openai` adds `--n`, `--moderation`, `--mask`, and `--input-fidelity`
- `request create --request-operation edit` uses multipart upload for image edits
