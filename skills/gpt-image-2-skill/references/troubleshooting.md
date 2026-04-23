# Troubleshooting

Decision tree for the most common failures. Always run `--json doctor` first to confirm runtime, provider auth, and retry policy in one shot.

## `runtime_unavailable`

The Node wrapper could not resolve a Rust binary.

Resolution order is: `GPT_IMAGE_2_SKILL_BIN` → `PATH` → repo-local `cargo run` → cached release binary → bootstrap download.

Fixes:

- `cargo install gpt-image-2-skill --locked`
- `brew install wangnov/tap/gpt-image-2-skill`
- `npm install --global gpt-image-2-skill`
- or set `GPT_IMAGE_2_SKILL_BIN=/abs/path/to/gpt-image-2-skill`

If bootstrap is undesirable in CI, set `GPT_IMAGE_2_SKILL_SKIP_BOOTSTRAP=1`.

## `auth_missing`

Provider auth absent for the resolved provider.

- OpenAI: export `OPENAI_API_KEY` or pass `--api-key sk-...`
- Codex: ensure `~/.codex/auth.json` exists. The Codex desktop app writes it on first sign-in. `$CODEX_HOME` overrides the directory.

Use `--json auth inspect` to see which provider has `ready: true`.

## `auth_parse_failed`

`auth.json` exists but cannot be parsed. Re-sign-in through Codex desktop, or restore a known-good `auth.json` from backup.

## Codex `401` and `refresh_failed`

A `401` from the Codex endpoint triggers exactly one access-token refresh against `https://auth.openai.com/oauth/token`, then one retry. If refresh itself fails:

- `refresh_failed` with `error.detail.error` containing the underlying message
- common causes: expired refresh token (re-sign-in needed), network blocked, OAuth server outage

## Retries and transient errors

The runtime retries up to `DEFAULT_RETRY_COUNT = 3` times with exponential backoff (`1s → 2s → 4s`). Retried error classes are determined by `should_retry` in `lib.rs`; non-retryable errors fail fast.

Watch retry behavior live with `--json-events` and grep stderr for `"phase":"retry_scheduled"`.

## Image-size rejections

`code: "invalid_argument"` with a size-related message means a custom `WIDTHxHEIGHT` violated one of:

- both edges multiples of 16
- max edge 3840
- max total pixels 8,294,400
- max aspect ratio 3:1

Use `2K` or `4K` aliases when in doubt.

## Moderation refusals (OpenAI)

OpenAI may reject prompts. The runtime surfaces the upstream error verbatim under `error.detail`. Adjust the prompt or set `--moderation low` (where supported by the account) and retry.

## Network and timeout

- `network_error` — transport-level failure (DNS, TLS, connection reset). Retried automatically.
- Hard timeout: `DEFAULT_REQUEST_TIMEOUT = 300s` for image requests, `DEFAULT_REFRESH_TIMEOUT = 60s` for token refresh.

## Self-test

Run the bundled self-test as a smoke check:

```bash
node scripts/selftest.cjs
```

It calls `--json doctor` and `--json auth inspect`, then prints a one-line summary including which providers are ready.
