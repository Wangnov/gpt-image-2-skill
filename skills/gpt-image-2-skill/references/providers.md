# Providers

Built-in providers and named providers share the same command surface. Pick a built-in provider with `--provider <openai|codex|auto>`, or pass any provider name from shared config.

## Selection logic

- `--provider openai` — force OpenAI HTTP API.
- `--provider codex` — force Codex `image_generation` tool through `~/.codex/auth.json`.
- `--provider auto` (default) — use `default_provider` from shared config, then legacy OpenAI/Codex auto-selection.
- `--provider <name>` — resolve an `openai-compatible`, `codex`, or `atlas` provider from `$CODEX_HOME/gpt-image-2-skill/config.json`.

The resolved provider appears in `doctor` output as `provider_selection.resolved`.

## Shared config

Default paths:

| Item | Path |
|---|---|
| Config | `$CODEX_HOME/gpt-image-2-skill/config.json` |
| History | `$CODEX_HOME/gpt-image-2-skill/history.sqlite` |
| Jobs | `$CODEX_HOME/gpt-image-2-skill/jobs/` |

Example provider:

```json
{
  "version": 1,
  "default_provider": "my-image-api",
  "providers": {
    "my-image-api": {
      "type": "openai-compatible",
      "api_base": "https://example.com/v1",
      "model": "gpt-image-2",
      "credentials": {
        "api_key": { "source": "file", "value": "sk-..." }
      }
    }
  }
}
```

Credential sources:

| Source | Shape |
|---|---|
| File | `{ "source": "file", "value": "sk-..." }` |
| Env | `{ "source": "env", "env": "MY_API_KEY" }` |
| Keychain | `{ "source": "keychain", "service": "gpt-image-2-skill", "account": "providers/name/api_key" }` |

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

## Atlas Cloud provider

Atlas Cloud uses an asynchronous image API, so configure it as `type: "atlas"` rather than `openai-compatible`:

```json
{
  "version": 1,
  "providers": {
    "atlas-cloud": {
      "type": "atlas",
      "model": "openai/gpt-image-2/text-to-image",
      "supports_n": false,
      "edit_region_mode": "none",
      "credentials": {
        "api_key": { "source": "env", "env": "ATLASCLOUD_API_KEY" }
      }
    }
  }
}
```

Run text-to-image generation with `--provider atlas-cloud`. The default API base is `https://api.atlascloud.ai`; `api_base` can override it for testing or a compatible deployment. Atlas generation POSTs are never retried. The client only retries bounded result polling GETs and downloads completed output URLs without forwarding the Atlas authorization header.

The Atlas provider currently supports one generated image in `jpeg` or `png` format. Image editing, transparent source generation, non-auto backgrounds, WebP, and output compression fail before submission.

## Runtime discovery and update

There are two related questions:

- freshness policy: which installed runtime should the Agent inspect or update before work?
- wrapper resolution: which runtime will `node scripts/gpt_image_2_skill.cjs ...` actually execute?

### Runtime freshness policy

Check upstream first:

```bash
npm view gpt-image-2-skill version
```

Then inspect installed runtimes in this order:

1. Tauri App bundled CLI. Standard macOS path:

   ```bash
   APP_CLI="/Applications/GPT Image 2.app/Contents/Resources/bin/gpt-image-2-skill"
   [ -x "$APP_CLI" ] && "$APP_CLI" --version
   ```

   The app bundle is user-managed software. If it exists and is older than upstream, ask the user before updating or replacing the app. Do not silently modify `/Applications/GPT Image 2.app`.

2. Shell CLI:

   ```bash
   command -v gpt-image-2-skill || true
   gpt-image-2-skill --version || true
   npm list -g --depth=0 gpt-image-2-skill || true
   cargo install --list 2>/dev/null | rg -n 'gpt-image-2-skill' -C 1 || true
   ```

   If no app bundle exists and the shell CLI is missing or older than upstream, update silently:

   ```bash
   npm install -g gpt-image-2-skill@latest
   command -v gpt-image-2-skill
   gpt-image-2-skill --version
   ```

3. Skill wrapper runtime:

   ```bash
   node scripts/gpt_image_2_skill.cjs --json doctor
   node scripts/selftest.cjs
   ```

If `gpt-image-2-skill --version` and `node scripts/gpt_image_2_skill.cjs --version` disagree, the shell and wrapper are using different runtimes. Fix the shell CLI when the user or examples call `gpt-image-2-skill` directly; otherwise prefer the wrapper in this skill directory for reproducible execution.

Treat `unrecognized subcommand 'transparent'` or any documented command missing from `--help` as stale runtime evidence first.

### Wrapper resolution order

The Node wrapper at `scripts/gpt_image_2_skill.cjs` resolves the underlying Rust binary in this order:

1. `GPT_IMAGE_2_SKILL_BIN` env (absolute path to a binary)
2. `gpt-image-2-skill` on `PATH` (e.g. installed via cargo, brew, npm)
3. Tauri App bundled CLI (`GPT_IMAGE_2_SKILL_APP_BIN` or standard app bundle locations)
4. Repo-local `cargo run -q -p gpt-image-2-skill --` (only if `Cargo.toml` and `cargo` exist)
5. Cached release binary at `${XDG_CACHE_HOME:-~/.cache}/gpt-image-2-skill/<version>/<target>/`
6. Bootstrap: download the matching GitHub Release archive, extract the binary, cache it

Set `GPT_IMAGE_2_SKILL_SKIP_BOOTSTRAP=1` to disable the download step.
