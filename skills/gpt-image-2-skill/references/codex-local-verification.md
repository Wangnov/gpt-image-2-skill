# 本地 Codex 生图验证

验证日期：2026-09-09。运行时：Skill Node wrapper → 本机 CLI 0.7.3。显式 `--provider codex`，使用本机 Codex ChatGPT 登录。结果仅代表当时的账户和后端，不推断所有账户的发布状态。

## 首次探测结果

| 请求 | 结果 |
|---|---|
| 普通生图，默认外层 `gpt-5.4` | HTTP 400：该模型不支持当前 ChatGPT 账户的 Codex 路径 |
| 普通生图，显式外层 `gpt-6-astra` | 成功，最终 `ok: true`，PNG 可解码且通过视觉检查 |
| 原始请求，外层 Astra，工具模型 `gpt-image-2.5-flare`，透明背景 | HTTP 400：`Transparent background is not supported for this model.` |
| 原始请求，外层 Astra，工具模型 Flare，不透明背景 | 生图成功，但 `response.created` 和 `response.completed` 中 `tools[].model` 都是 `gpt-image-2-codex` |

普通成功请求也返回 `gpt-image-2-codex`。不能凭成功响应就宣称 Flare 选择生效，也不能仅凭这个服务端别名判断其内部权重属于 Image 2 或 2.5。首次探测未测 Sunburst；后续 10 次对照已经覆盖，见下节。

两张成功图片均请求 `1024x1024`，实际 PNG 是 `1254x1254`。服务端工具描述中的 `size` / `quality` 为 `auto`，最终图像项的质量为 `low`。应分别记录请求参数、上游元数据和文件实际尺寸，不承诺 Codex 严格执行分辨率。

第一张图片为橙色纸雕狐狸与蓝绿色月牙，文字“本地生图成功”可见且正确。第二张为深蓝背景的纸雕狐狸。原始日志和图片保留在本地仓库 `artifacts/codex-image-20260909/`，该目录不参与发布，日志可能含账户标识，勿直接公开。

## 追加 10 次对照（同日）

固定外层 `gpt-6-astra`、两路并发，实际发出 10 次请求，无重试；7 次出图、3 次 HTTP 400，批次耗时 166.12 秒。

| 组别 | 次数 | 结果 |
|---|---:|---|
| 默认 / Flare / Sunburst，不透明，1024×1024 | 3 | 全部成功，返回工具模型均为 `gpt-image-2-codex` |
| `background=auto`，只在提示词中要求透明 | 1 | 成功生成真正 RGBA，最终图像项 `background=transparent` |
| 默认 / Flare / Sunburst，显式 `background=transparent` | 3 | 全部 HTTP 400，透明参数不受支持 |
| 默认模型，不透明，1536×1024 / 2048×2048 / 3840×2160 | 3 | 全部成功，但实际均为 1254×1254 |

7 张图全部为 1254×1254。2K 的 `quality=high` 最终返回 `low`；提示词透明的 `quality=low` 最终返回 `medium`。size / quality 参数均不能按请求值作保证。尺寸未写入提示词，本实验没有验证提示词控制画幅。

所有成功响应的模型字段没有出现 2.5，仅有外层 Astra 和工具别名 `gpt-image-2-codex`。显式 Flare / Sunburst 被接受不等于切换生效；别名也不能证明底层权重版本。

**透明能力修正**：不能再笼统描述为“Codex 不能出透明图”。`auto` 加透明提示词本次得到真实 alpha（0–255，840,697 个全透明像素），但 `transparent verify --profile icon --strict` 未通过，唯一失败项为 `transparent_rgb_not_scrubbed`。真实透明与严格交付合格是两个判断；该路径仅成功一个样本，不承诺稳定性。保留原生 alpha，先验证，必要时清理或采用本地提取方案，不应无条件重新抠图。

可复核的本地批次文件位于 `artifacts/codex-image-20260909/batch-10/`：`report.md`、`summary.json`、逐次请求与事件、原始 PNG、透明验收 JSON。均不参与 Skill 发布。

## 提示词与参数成对对照（同日追加）

再完成 10 次请求，全部出图，无重试，耗时 211.53 秒。固定外层 Astra 和原始 Responses 路径，以相同主体、相同提示词或参数的成对条件比较。

| 对照 | 实际结果 | 判断 |
|---|---|---|
| 仅参数1536×1024；再加入同尺寸提示词 | 1254×1254 → 1536×1024 | 提示词确实影响尺寸 |
| 参数1024×1536竖图，提示词1536×1024横图 | 1536×1024 | 本次尺寸冲突跟随提示词 |
| 参数auto，提示词3840×2160与16:9 | 1672×941 | 画幅近似16:9，但不是原生4K |
| 透明提示词，background auto / opaque | auto生成RGBA；opaque生成RGB棋盘格假透明 | opaque参数有实际约束，不能说所有参数无效 |
| 参数jpeg、不写格式提示词 | 真正JPEG | 输出格式参数有效 |
| 参数png、提示词要求JPEG | 仍为PNG | 格式冲突时参数优先 |
| 参数low、提示词明确要求工具quality=high | 最终仍为low | 提示词不能保证质量档位 |

透明候选再次生成真实 alpha，但严格图标验收仍因 `transparent_rgb_not_scrubbed` 未通过。两个批次共有两次 prompt-only 透明成功样本，仍不足以承诺稳定成功率。

结论：把期望尺寸与比例写入 Codex 提示词，同时保留对应参数并检查输出；透明请求用 auto + 明确透明意图，保留并验证 alpha；格式继续用参数控制。不能把提示词视为精确尺寸或质量的硬保证。遇到尺寸不符，应报告原始尺寸；不要将后处理放大称为原生4K。

证据：本地 `artifacts/codex-image-20260909/prompt-vs-params/report.md` 和 `summary.json`。关于 App 更新后的原生调用路径，另见 `codex-native-imagegen.md`。

## 可复用普通命令

从 Skill 目录运行，输出目录应使用新的路径以免覆盖旧图片：

```bash
mkdir -p output
node scripts/gpt_image_2_skill.cjs --json --json-events --provider codex \
  images generate --model gpt-6-astra \
  --prompt "橙色纸雕小狐狸，深蓝背景，正方形构图" \
  --out output/codex-fox.png --format png \
  > output/result.json 2> output/events.jsonl
```

## 原始请求的模型选择实验

仅在用户明确要求测试模型选择时使用。下面的工具模型是请求值，不是已验证生效值：

```json
{
  "model": "gpt-6-astra",
  "instructions": "Generate exactly one image using the image_generation tool.",
  "store": false,
  "stream": true,
  "input": [{"role": "user", "content": [{"type": "input_text", "text": "橙色纸雕小狐狸，深蓝背景"}]}],
  "tools": [{"type": "image_generation", "model": "gpt-image-2.5-flare", "background": "opaque", "output_format": "png"}]
}
```

保存为 `output/body.json` 后执行：

```bash
node scripts/gpt_image_2_skill.cjs --json --json-events --provider codex \
  request create --request-operation responses \
  --body-file output/body.json --out-image output/model-probe.png --expect-image \
  > output/probe-result.json 2> output/probe-events.jsonl
```

验收：进程退出成功、最终 JSON `ok: true`、图片存在且可解码，并视觉检查。解析事件 `type == "response.created"` 或 `"response.completed"` 的 `data.response.tools`，与请求的工具模型比较。当前 CLI 的 `request.delegated_image_model` 为硬编码，不能用作模型判定。
