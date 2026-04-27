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
| `transparent_verification_failed` | runtime | transparent PNG extraction completed but final alpha verification did not pass |
| `transparent_input_mismatch` | runtime | dual-background extraction sources have different dimensions |

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

### `transparent generate`

Returns the final verified transparent PNG. The command fails with `transparent_verification_failed` if the final file does not pass the built-in gate.

```json
{
  "ok": true,
  "command": "transparent generate",
  "provider": "codex",
  "request": {
    "prompt": "...",
    "source_prompt": "...",
    "method": "chroma",
    "profile": "generic",
    "matte_color": "#00ff00",
    "spill_suppression": 0.85,
    "format": "png"
  },
  "source": {
    "path": "/tmp/source.png",
    "kept": false,
    "generation": { "...": "images generate payload" }
  },
  "extraction": { "method": "chroma", "...": "..." },
  "verification": {
    "passed": true,
    "profile": "generic",
    "is_png": true,
    "has_alpha": true,
    "input_has_alpha": true,
    "alpha_min": 0,
    "alpha_max": 255,
    "transparent_ratio": 0.42,
    "partial_pixels": 1234,
    "checkerboard_detected": false,
    "touches_edge": false,
    "edge_margin_px": 96,
    "stray_pixel_count": 0,
    "largest_component_ratio": 1.0,
    "matte_residue_checked": true,
    "matte_residue_score": 0.01,
    "halo_score": 0.0,
    "transparent_rgb_scrubbed": true,
    "quality_score": 0.99,
    "failure_reasons": [],
    "warnings": []
  },
  "output": {
    "path": "/tmp/asset.png",
    "bytes": 123456,
    "files": [{ "index": 0, "path": "/tmp/asset.png", "bytes": 123456 }]
  }
}
```

### `transparent extract`

Runs local extraction only. Use `--strict` when the command should fail if verification does not pass.

```json
{
  "ok": true,
  "command": "transparent extract",
  "method": "dual",
  "profile": "glow",
  "extraction": {
    "method": "dual",
    "rgb_scrubbed": true,
    "dual_alignment": {
      "score": 0.92,
      "passed": true,
      "negative_delta_ratio": 0.0,
      "delta_channel_noise": 0.03,
      "color_space": "srgb"
    }
  },
  "verification": { "passed": true, "...": "..." },
  "output": { "path": "/tmp/asset.png", "files": [] }
}
```

Chroma extraction reports `threshold`, `softness`, and `spill_suppression`; `spill_suppression` is a `0..1` matte-edge cleanup strength and defaults to `0.85`.

### `transparent verify`

Verifies any image file as a transparent PNG deliverable. With `--strict`, a failed verification returns the standard error envelope.

```json
{
  "ok": true,
  "command": "transparent verify",
  "profile": "icon",
  "passed": true,
  "verification": {
    "profile": "icon",
    "width": 2048,
    "height": 2048,
    "is_png": true,
    "has_alpha": true,
    "input_has_alpha": true,
    "alpha_min": 0,
    "alpha_max": 255,
    "transparent_pixels": 1000000,
    "partial_pixels": 50000,
    "checkerboard_detected": false,
    "touches_edge": false,
    "edge_margin_px": 80,
    "component_count": 1,
    "largest_component_ratio": 0.99,
    "stray_pixel_count": 24,
    "alpha_noise_score": 0.00001,
    "matte_residue_checked": false,
    "matte_residue_score": null,
    "halo_score": 0.0,
    "transparent_rgb_scrubbed": true,
    "quality_score": 0.99,
    "failure_reasons": [],
    "warnings": []
  }
}
```

`matte_residue_checked` is false unless the verifier received `--expected-matte-color`. For chroma-derived outputs, a passing verification with `matte_residue_checked: false` did not check source-matte edge residue.

## When `--json` is omitted

Without `--json`, errors print to stderr and successful commands print human-readable summaries to stdout. Always pass `--json` when an agent is parsing the result.
