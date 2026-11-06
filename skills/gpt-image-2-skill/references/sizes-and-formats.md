# Sizes, formats, and shared options

运行时参数见 `crates/gpt-image-2-core/src/cli_types.rs`。2.5 公共 API 新增 `xhigh/max`，当前 CLI 和桌面界面已提供这两个档位；请显式选择支持它们的 2.5 模型。 Override with the matching `--size`, `--format`, `--quality`, `--compression`, or `--background` flag.

2.6 的 complexity、markup、SVG 作者与 GIF 帧参数见 [image-2.6.md](image-2.6.md)。CLI 默认 OpenAI 模型为 `gpt-image-2.6-sunburst`，也可选择 `gpt-image-2.6-flare`；原有显式模型配置优先。

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
- min total pixels: `655_360`
- max total pixels: `8_294_400`
- max aspect ratio: `3:1` (longest / shortest ≤ 3.0)
- square high-resolution ceiling in practice: `2880x2880`

上述像素和比例限制用于静态图和 SVG 的参考渲染图。GIF 仅在 CLI 检查正整数及 16 的倍数，具体帧尺寸与合图预算由 API 校验；小于静态图最低像素的帧可以通过 CLI，但仍可能因合图预算被 API 拒绝。

Violations return `code: "invalid_command"` (clap layer, e.g. non-multiple-of-16 caught at parse time) or `code: "invalid_argument"` (runtime layer, e.g. total-pixel cap caught after parsing) with the failing constraint in `error.message`.

## Format and quality

| Flag | Values | Notes |
|---|---|---|
| `--format` | `png`, `jpeg`, `webp`, `gif`, `svg` | GIF/SVG 仅限支持它们的 Images API 模型；SVG 仅生成且 n=1 |
| `--quality` | `low`, `medium`, `high`, `xhigh`, `max`, `auto` | provider-side rendering quality |
| `--complexity` | `low`, `medium`, `high` | 2.6 绘制规划；独立于 quality，省略时上游默认 high |
| `--compression` | `0`–`100` | JPEG/WebP compression level |
| `--background` | `auto` (default), `transparent`, `opaque` | OpenAI 的支持情况取决于模型；2.5 支持原生透明。Codex 会发送该字段，本次透明请求被拒绝，不透明请求成功。 |

## 参数接受与上游执行

| Flag | 两种 CLI 路径都接受 | OpenAI only |
|---|---|---|
| `--size` | yes | |
| `--quality` | yes | |
| `--format` | yes | |
| `--compression` | yes | |
| `--background` | yes，Codex 显式 transparent 当前被拒绝 | |
| `--n` | | yes (request multiple images) |
| `--moderation` | | yes |
| `--mask` | | yes (PNG mask for `images edit`) |
| `--input-fidelity` | | yes |

不要将本地 CLI 接受参数等同于 Codex 服务端执行参数。本次 7 张成功图的 size 均被改变，quality 也出现 high→low、low→medium。 The runtime returns `code: "unsupported_option"` if `--n`, `--moderation`, `--mask`, or `--input-fidelity` is passed with `--provider codex`; `--background` is sent by the runtime; the local raw transparency probe was rejected by the upstream. Codex 背景要求可同时写入提示词并传参数，但必须检查实际输出；`auto` 配合透明提示词曾生成真实 RGBA，但仍需严格验收，不能以提示词代替 alpha 检查。尺寸实测参见 `codex-local-verification.md`。

## 提示词优先级的实测边界

在本项目 Codex Responses 路径中：尺寸提示词能改变画幅，且曾覆盖相反的size参数；但4K像素要求未执行。`background=opaque` 压过透明提示词，`output_format` 压过冲突的格式提示词，`quality=high` 的提示词也未保证high档位。不要把“部分参数被归一化”扩大成“所有参数无效”。详见 `codex-local-verification.md`。

## Reference image inputs

`images edit` and `request create --request-operation edit` accept:

- `--ref-image <path>` (repeatable on `images edit`)
- HTTPS URLs（multipart 路径先由 CLI 安全下载；HTTP 被拒绝）
- data URLs (`data:image/png;base64,...`)

OpenAI edit requests are sent as `multipart/form-data`. Codex edits embed the reference inside the `image_generation` tool input.

`--markup` 为独立透明 PNG 标注层，与 `--mask` 互斥。raw edit 的 `images`、`mask` 或 `markup` 使用 file_id 时改走 JSON，避免文件 ID 在 multipart 转换中丢失。SVG 不能作为编辑参考图。

For style-lock references, prefer a flat RGB image. Transparent PNG references can carry premultiplied edges, invisible RGB, or alpha artifacts into the edit. Flatten the reference first unless the alpha itself is the intended visual signal.
