# Sizes, formats, and shared options

All values below come from `crates/gpt-image-2-skill/src/lib.rs`. Override with the matching `--size`, `--format`, `--quality`, `--compression`, or `--background` flag.

## Size aliases

| Input | Resolves to |
|---|---|
| `auto` | model-default size |
| `2K` | `2048x2048` |
| `4K` | `3840x2160` |
| `2160x3840` | portrait 4K |
| `WIDTHxHEIGHT` | custom (must satisfy constraints below) |

## Custom size constraints

Custom `WIDTHxHEIGHT` must satisfy ALL of:

- both edges are multiples of `16`
- max single edge: `3840`
- max total pixels: `8_294_400`
- max aspect ratio: `3:1` (longest / shortest ≤ 3.0)
- square high-resolution ceiling in practice: `2880x2880`

Violations return `code: "invalid_argument"` with the failing constraint in `error.message`.

## Format and quality

| Flag | Values | Notes |
|---|---|---|
| `--format` | `png`, `jpeg`, `webp` | output container |
| `--quality` | `low`, `medium`, `high`, `auto` | provider-side rendering quality |
| `--compression` | `0`–`100` | JPEG/WebP compression level |
| `--background` | `auto` (default), `transparent`, `opaque` | request transparent PNG/WebP via `transparent` |

## Shared vs OpenAI-only

| Flag | Shared | OpenAI-only |
|---|---|---|
| `--background` | yes | |
| `--size` | yes | |
| `--quality` | yes | |
| `--format` | yes | |
| `--compression` | yes | |
| `--n` | | yes (request multiple images) |
| `--moderation` | | yes |
| `--mask` | | yes (PNG mask for `images edit`) |
| `--input-fidelity` | | yes |

Codex requests ignore `--n`, `--moderation`, `--mask`, and `--input-fidelity`; the runtime returns `code: "unsupported_option"` if any are passed with `--provider codex`.

## Reference image inputs

`images edit` and `request create --request-operation edit` accept:

- `--ref-image <path>` (repeatable on `images edit`)
- HTTP(S) URLs (downloaded server-side by OpenAI; pass through unchanged)
- data URLs (`data:image/png;base64,...`)

OpenAI edit requests are sent as `multipart/form-data`. Codex edits embed the reference inside the `image_generation` tool input.
