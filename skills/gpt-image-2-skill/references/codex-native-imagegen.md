# Codex App 原生 Imagegen 与 CLI 路径

核查日期：2026-09-09。本机 App 26.903.61454（8378），随包 codex-cli 0.153.4。

## 已确认事实

- Electron 包的 `imagegen-25-announcement-modal` 导出 `ImageGen25AnnouncementModal`，中文提示与“图像创作迎来重大升级”一致。点击仅预填创建图片的提示词，没有显式设置 Flare / Sunburst。
- 原生图像执行位于随包执行器，而不是 Electron 界面代码。工具名为 `image_gen.imagegen`，暴露 prompt、referenced_image_paths、num_last_images_to_include。
- 同版本官方实现通过当前 provider 的 `images/generations` / `images/edits` JSON 端点请求。ChatGPT provider 的 base URL 是 `https://chatgpt.com/backend-api/codex`。
- 原生生成请求仍使用 `model=gpt-image-2`，background/quality/size 默认 auto。客户端响应结构不包含实际模型版本，因此不能仅凭请求名称判断权重是否已经升级。
- 当前项目 CLI 的 Codex provider 使用 `/codex/responses` 与服务端 `image_generation` 工具。这与原生独立 Images 路径不同。调整旧请求的 `tools[].model` 不等于复现 App 原生行为。

## 宿主原生工具验证路径

当任务是复现最新 Codex App 的生图行为，而且宿主已经提供 `image_gen.imagegen` 时，直接使用该工具。生成新图只传 prompt；编辑按宿主当前工具定义提供参考图。不要虚构 model、quality、size 参数；期望尺寸、画幅和背景写入提示词。

用户明确要求本项目 CLI / App / HTTP 后端时，仍使用对应产品运行时，并说明它目前走 Responses 路径。不要将原生工具测试成功宣称为 CLI 已适配。

原生工具已实测成功生成 1536×1024 RGBA。真实 alpha 存在，但图标严格验收未通过：全透明区域 RGB 未清零，视觉上还有较大半透明光晕。输出位于 Codex generated_images；复制进项目保留原件，并检查图片、尺寸和 alpha 后交付。

独立脚本使用同一本机 Codex 登录访问原生 HTTP 端点、尝试显式 Flare 时返回 Cloudflare 403 / error 1010；没有模型判定结果。不能宣称 Flare 不支持，也不能把直连脚本作为已验证方案。不修改 App gate 或身份来绕过拒绝。

## 后续 CLI 适配边界

需要独立 Images 请求构造、JSON 响应解析、编辑图像输入适配、认证/错误处理与回归验证，不能仅把旧默认模型名替换为2.5。现有 Responses 通路应保留兼容，实际版本报告依赖上游证据。

## 可核查来源

本机提取证据和实测保留在仓库 `artifacts/codex-app-image-investigation/report.md`，不随 Skill 分发。

- [同版本原生工具默认请求](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/ext/image-generation/src/tool.rs#L422)
- [同版本独立 Images 端点](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/codex-api/src/endpoint/images.rs#L35)
- [同版本请求与响应结构](https://github.com/openai/codex/blob/rust-v0.153.4/codex-rs/codex-api/src/images.rs)


## 复杂中文与防回退补充（2026-09-09）

同文案白底/透明底、旧Responses/原生工具共4张均为1536×1024，透明样本有真实alpha。常规中文可读，但辨字、生僻字均未全对。无已知版本控制组，不能用这些结果识别1.5/2/2.5。最新官方[提示词指南](https://developers.openai.com/api/docs/guides/image-prompting)已列Image 2透明preview及2.5透明支持。禁止自行降到1.5；当前实际权重版本保持unknown。本轮报告位于仓库artifacts/codex-chinese-audit/report.md。
