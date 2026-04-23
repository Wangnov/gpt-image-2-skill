# Providers

Three provider modes share the same command surface. Pick one with `--provider <openai|codex|auto>`.

## Selection logic

- `--provider openai` — force OpenAI HTTP API.
- `--provider codex` — force Codex `image_generation` tool through `~/.codex/auth.json`.
- `--provider auto` (default) — prefer `OPENAI_API_KEY`; fall back to a parseable Codex `auth.json`.

The resolved provider appears in `doctor` output as `provider_selection.resolved`.

## OpenAI provider

| Item | Default |
|---|---|
| Model | `gpt-image-2` (override with `-m/--model`) |
| API base | `https://api.openai.com/v1` (override with `--openai-api-base`) |
| Generate path | `/images/generations` |
| Edit path | `/images/edits` (multipart upload) |
| Auth source | `OPENAI_API_KEY` env, then `--api-key` flag |

OpenAI-only flags: `--n`, `--moderation`, `--mask`, `--input-fidelity`.

OpenAI-compatible bases (e.g. `https://api.duckcoding.ai/v1`) work as long as they implement `/images/generations` and `/images/edits`.

## Codex provider

| Item | Default |
|---|---|
| Model | `gpt-5.4` (override with `-m/--model`) |
| Endpoint | `https://chatgpt.com/backend-api/codex/responses` |
| Image tool | `image_generation` (delegates to `gpt-image-2` server-side) |
| Auth source | `~/.codex/auth.json` or `$CODEX_HOME/auth.json` |
| Refresh endpoint | `https://auth.openai.com/oauth/token` |

Codex `401` triggers exactly one access-token refresh, then a single retry. Refresh failures surface as `refresh_failed` errors.

## Runtime resolution order

The Node wrapper at `scripts/gpt_image_2_skill.cjs` resolves the underlying Rust binary in this order:

1. `GPT_IMAGE_2_SKILL_BIN` env (absolute path to a binary)
2. `gpt-image-2-skill` on `PATH` (e.g. installed via cargo, brew, npm)
3. Repo-local `cargo run -q -p gpt-image-2-skill --` (only if `Cargo.toml` and `cargo` exist)
4. Cached release binary at `${XDG_CACHE_HOME:-~/.cache}/gpt-image-2-skill/<version>/<target>/`
5. Bootstrap: download the matching GitHub Release archive, extract the binary, cache it

Set `GPT_IMAGE_2_SKILL_SKIP_BOOTSTRAP=1` to disable the download step.
