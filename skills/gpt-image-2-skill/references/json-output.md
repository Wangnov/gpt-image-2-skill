# JSON stdout schema (`--json`)

Pass `--json` to receive a single JSON object on stdout. All commands return either a success envelope or a uniform error envelope.

## Error envelope

Every failure looks like this. The `detail` field is optional and provider-specific.

```json
{
  "ok": false,
  "error": {
    "code": "string_code",
    "message": "Human-readable summary.",
    "detail": { "...": "optional context" }
  }
}
```

Common `code` values:

| Code | Layer | Meaning |
|---|---|---|
| `runtime_unavailable` | wrapper | Node wrapper could not resolve a Rust binary |
| `invalid_command` | clap | unknown flag, missing required arg, or `--size` value rejected by clap-level parsing (e.g. `5000x5000` is not a multiple of 16) |
| `invalid_argument` | runtime | business-layer validation failure after clap accepted the input |
| `unsupported_option` | runtime | flag passed to a provider that does not accept it (e.g. `--mask` with `--provider codex`) |
| `auth_missing` | runtime | provider auth not present |
| `auth_parse_failed` | runtime | `auth.json` exists but cannot be parsed |
| `refresh_failed` | runtime | Codex token refresh failed |
| `network_error` | runtime | transport-level failure |
| `http_error` | runtime | upstream returned non-2xx |
| `invalid_body_json` | runtime | `request create` body file or stdin not valid JSON |

## Success envelopes by command

### `doctor`

```json
{
  "ok": true,
  "provider_selection": { "resolved": "openai", "...": "..." },
  "retry_policy": {
    "max_retries": 3,
    "base_delay_seconds": 1
  }
}
```

### `auth inspect`

```json
{
  "ok": true,
  "providers": {
    "openai": {
      "provider": "openai",
      "ready": true,
      "auth_source": "env",
      "api_key_present": true
    },
    "codex": {
      "provider": "codex",
      "ready": true,
      "parse_ok": true,
      "auth_mode": "chatgpt_token"
    }
  }
}
```

### `images generate` (OpenAI)

```json
{
  "ok": true,
  "provider_selection": { "resolved": "openai" },
  "request": { "model": "gpt-image-2", "size": "2048x2048", "...": "..." },
  "retry": { "count": 0, "max_retries": 3 },
  "data": { "...": "image metadata + saved file path" }
}
```

### `images edit` (OpenAI multipart)

Same envelope as `images generate`. The `request` object includes `operation: "edit"` and `ref_image_count: <N>` instead of size hints. Multipart transport is reported in **stderr** as the `multipart_prepared` progress event (`type: "multipart_prepared"`), not on stdout. Token usage in `response.usage` splits into `input_tokens_details.image_tokens` and `text_tokens` for edits.

### `request create`

Returns the raw upstream JSON wrapped in the standard envelope:

```json
{
  "ok": true,
  "data": { "...": "raw OpenAI or Codex response body" }
}
```

When `--expect-image` is set, the runtime decodes the first image payload into `--out-image` and adds `image_path` to `data`.

## When `--json` is omitted

Without `--json`, errors print to stderr and successful commands print human-readable summaries to stdout. Always pass `--json` when an agent is parsing the result.
