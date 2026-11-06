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
| `runtime_outdated` | wrapper | CLI 缺少当前 skill 要求的 2.6 能力；构建或安装新 CLI |
| `invalid_command` | clap | unknown flag, missing required arg, or `--size` value rejected by clap-level parsing (e.g. `5000x5000` is not a multiple of 16) |
| `invalid_argument` | runtime | business-layer validation failure after clap accepted the input |
| `markup_invalid` | runtime | 标注层格式、透明像素、尺寸或像素预算校验失败 |
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
  "request": { "model": "gpt-image-2.6-sunburst", "size": "2048x2048", "complexity": "low" },
  "retry": { "count": 0, "max_retries": 3 },
  "response": { "usage": {}, "svg_usage": null, "image_count": 1 },
  "output": { "path": "/tmp/out.png", "bytes": 1234, "files": [{"index": 0, "path": "/tmp/out.png", "bytes": 1234}] }
}
```

### `images edit` (OpenAI multipart)

Same envelope as `images generate`. The `request` object includes `operation: "edit"` and `ref_image_count: <N>` instead of size hints. Multipart transport is reported in **stderr** as the `multipart_prepared` progress event (`type: "multipart_prepared"`), not on stdout. Token usage in `response.usage` splits into `input_tokens_details.image_tokens` and `text_tokens` for edits.

markup 编辑含 `request.markup_present: true`。SVG 作者 token 在独立的 `response.svg_usage` 中，不能与渲染图的 `response.usage` 混淆。GIF 的请求参数在 `request.frame_count` / `frame_duration_ms`，上游报告值在 `response`，缺失时为 null；实际帧数/时长仍需读取 GIF 文件。`safety_identifier` 仅在请求摘要中显示 `safety_identifier_present`，不会回显标识内容。

### `request create`

返回请求摘要、响应元数据和可选的图片输出；base64 内容不会回显到 stdout：

```json
{
  "ok": true,
  "request": { "operation": "generate", "model": "gpt-image-2.6-flare" },
  "response": { "usage": {}, "svg_usage": null },
  "image_output": { "path": "/tmp/out.svg", "bytes": 1234, "files": [] }
}
```

提供 `--out-image` 时将结果原样写入文件；`--expect-image` 要求响应中确实有图片。未提供输出路径时，`image_output` 包含 available、count 和 suggested_extension。

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
    "material": null,
    "requested_matte_color": "#00ff00",
    "matte_color": "#00ff00",
    "matte_color_source": "auto-sampled",
    "threshold": 28.0,
    "softness": 34.0,
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
    "alpha_health_score": 1.0,
    "residue_score": 0.99,
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
  "material": null,
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

Chroma extraction reports `matte_color`, `matte_color_source`, `threshold`, `softness`, `spill_suppression`, and `material`. `matte_color_source` is `"auto-sampled"` when `--matte-color auto` was used or no matte was provided, and `"provided"` when a color was explicit. `spill_suppression` is a `0..1` matte-edge cleanup strength and defaults to `0.85`.

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
    "alpha_health_score": 1.0,
    "residue_score": 0.99,
    "quality_score": 0.99,
    "failure_reasons": [],
    "warnings": []
  }
}
```

`matte_residue_checked` is false unless the verifier received `--expected-matte-color`. For chroma-derived outputs, a passing verification with `matte_residue_checked: false` did not check source-matte edge residue.

## When `--json` is omitted

Without `--json`, errors print to stderr and successful commands print human-readable summaries to stdout. Always pass `--json` when an agent is parsing the result.
