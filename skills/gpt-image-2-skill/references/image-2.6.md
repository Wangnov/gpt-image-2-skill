# GPT Image 2.6：CLI 与 skill

本页针对 OpenAI Images API。Codex 订阅路径和第三方兼容服务须分别确认可用性。GUI 尚未提供这些新控件；使用 CLI 或本 skill 的 wrapper。

## 模型与规划

默认 `gpt-image-2.6-sunburst` 适合细致视觉工作；`gpt-image-2.6-flare` 用于快速迭代。`--model` 优先于 provider 配置，显式配置优先于默认值。通过 `models list` 读取本地能力目录，目录不代表账户权限。

`--complexity low|medium|high` 独立于渲染质量 `--quality low|medium|high|xhigh|max|auto`。complexity 省略时上游默认 high，单独调整 complexity 无额外收费项，但可能影响延迟和结果。简单改色或草稿可先用 low，复杂布局需比较实际结果。`transparent generate` 也支持 complexity。

## markup 引导编辑

```bash
node scripts/gpt_image_2_skill.cjs --json --provider openai images edit \
  --model gpt-image-2.6-flare --ref-image /tmp/original.png \
  --markup /tmp/annotation.png \
  --prompt "把红圈内的花瓶改成蓝色，移除红圈，保留其余内容" \
  --complexity low --quality medium --out /tmp/edited.png
```

原图排在 `--ref-image` 的第一位；其余图片仅作参考。标注层为独立透明 PNG，不能把标注合并到原图。CLI 会校正方向后比较尺寸，检查标注包含透明像素、文件不超过 50 MB，且首图和标注层各不超过 16,777,216 像素。markup 与 mask、prompt_rewriter 互斥。

普通编辑以 multipart 的 `markup` 文件上传；raw JSON 支持 `"markup": {"image_url": "https://..."}` 或 `{"file_id": "file-..."}`，两者只能选一项。任一输入含 file_id 时使用 JSON edit 请求，交由 API 校验远端文件。raw JSON 的原图数组字段是 `images`。

## SVG

```bash
node scripts/gpt_image_2_skill.cjs --json --provider openai images generate \
  --model gpt-image-2.6-sunburst --format svg --n 1 \
  --prompt "可编辑路径组成的蓝色月亮图标，纯色，无文字" \
  --quality low --complexity low --out /tmp/moon.svg
```

仅生成端点支持 SVG，不能编辑 SVG，也不能把 SVG 当作栅格参考图。SVG 要求 n=1，不支持 stream、partial_images、output_compression 或 prompt_rewriter。`--json-events` 是本地进度事件，可照常使用。

API 先渲染参考图，再由作者模型生成 SVG。quality 和 complexity 控制参考图；作者推理配置与它们分开。默认不传 `svg` 对象，让上游选作者。账户支持作者模型选择时，可用 `--svg-model <模型ID>`，再按该模型支持范围选择 `--svg-reasoning-effort none|minimal|low|medium|high|xhigh|max`。CLI 不猜测作者模型权限，也不自动替换作者。

返回 `data[].b64_json` 是 UTF-8 XML 的 base64。CLI 原样保存，不栅格化；未提供扩展名时自动识别 `.svg`。读取 `response.usage` 和独立的 `response.svg_usage` 评估两部分成本，不能只统计参考图。

## 动态 GIF

生成和编辑端点均支持 GIF；用静态参考图引导动画时选择 `images edit`。

| 参数 | 范围与默认值 |
| --- | --- |
| `--frame-count` | 2–16，省略为 9 |
| `--frame-duration-ms` | 至少 20；指南建议 20–2000；编码按 10 ms 舍入，上限 655,350 ms |
| `--size` | auto 或正整数的 WIDTHxHEIGHT，两边均为 16 的倍数；表示每帧尺寸 |

GIF 的具体帧尺寸、总像素和动画数量限制由所选模型决定。CLI 不对每帧套用静态图的 655,360 最低像素限制，也不臆造官方未列出的合图预算。2026-11-06 实测中，256x256、2 帧被两款模型的合图最低像素校验拒绝；过小尺寸同样可能失败。示例使用 640x640、2 帧、quality low。超过上限时减小帧数、尺寸或 n，低于合图预算时调整尺寸或帧数。

GIF 不支持 mask、stream、partial_images、output_compression 或 prompt_rewriter。输出是完整 GIF 字节，CLI 不转码、不丢帧；未写扩展名时自动保存 `.gif`。请求帧时长不一定等于编码后的时长，以实际文件为准。

## 验收与费用

先用最小样本验证账户权限和协议，再增加质量、帧数、分辨率或样本数。不要自动重试权限或参数错误，不更换用户指定的模型/provider。

检查最终 `ok`、真实输出路径、格式和实际内容。PNG/WebP 透明需检查 alpha；GIF 需检查帧数和时长；SVG 需解析 XML。返回的 request 记录期望值，response 记录上游报告值，不把请求字段当作实际执行证明。

2.6 的每百万 token 价格：文本输入 $5，图像输入 $8，图像输出 $30；SVG 作者另计。估算与账户账单存在延迟或统计口径差异。接口可使用 `--safety-identifier <稳定哈希>`（最多 128 字符），避免发送个人信息；CLI 摘要仅记录其是否存在。

官方依据：[生成指南](https://developers.openai.com/api/docs/guides/image-generation)、[生成接口](https://developers.openai.com/api/reference/resources/images/methods/generate)、[编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)、[价格](https://developers.openai.com/api/docs/pricing#image-generation)。
