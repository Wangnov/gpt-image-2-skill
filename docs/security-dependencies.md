# Dependency advisory remediation — 2026-09-13

## 2026-10-27 大版本迁移

- Vite 8.3.5 / React 插件 6.1.2 / TypeScript 7.0.2 一起迁移，移除插件 6 的临时忽略规则，并为 Vite 与 React 插件配置 Dependabot 分组。
- 分包配置改用 Rolldown 的 `codeSplitting`，保留现有 vendor 分组及 JavaScript 浏览器语法目标，启用源码执行顺序保护。配置路径改用原生 ESM 的 `import.meta.dirname`。
- TypeScript 7 默认入口不再提供旧编译器 AST API；翻译覆盖测试改用明确声明的 Babel 8 parser/types 开发依赖，仍解析全部 TS/TSX 源码并检查一千余处翻译调用及插值参数。
- dirs 7、rusqlite 0.41.0、tower-http 0.7.1，以及 ssh2 0.9.6、serde_json 1.0.154 同步更新。新增旧版 SQLite 表结构的历史记录重开、读写与完整性回归检查。
- 收拢其余直接依赖更新：Motion 14.6、Three 0.186、Node 类型 26.6，以及其余 Radix、React Query、Sonner 和 Workers 类型。Babel 8 要求前端构建使用 Node.js 22.18 或更新版本，包清单与 README 均已明确。
- reqwest 更新到 0.13.5，启用拆分后的 form/query 功能；TLS 证书校验使用 reqwest 0.13 的平台验证器；统一客户端构建入口显式初始化 ring，并尊重宿主已配置的加密实现，使 CLI 依赖图继续使用 ring。base64 同步到 0.23.1。远程参考图的 HTTPS、逐跳重定向检查、DNS 绑定和代理控制仍由原入口执行。
- 同步 login-action 4.7.0、cargo-binstall Action 1.26.0、rust-cache 2.9.3、upload-artifact 7.0.2 的完整 SHA，并更新发布工作流生成器的固定版本。
- 同步 Toggle Group 1.2.1、fake-indexeddb 6.2.6 和 Prettier 3.9.10；Vite 8 已移除旧 esbuild 安装脚本，仅删除对应精确版本的脚本授权。

## 2026-10-27 更新

- Wrangler 升级到 4.153.0，使用上游 miniflare 5.20261023.0-beta / undici 7.30.1，修复 GHSA-4qv8-2p9j-2685、GHSA-f72v-6w45-q472 和 GHSA-xjj6-f33q-929c。未降级 Wrangler，也未绕过 npm audit。
- 已检查 workerd 1.20261023.1 的安装脚本：按平台选择二进制，备用下载限定同一精确 npm 版本，并验证版本输出；仅更新该精确版本的 allowScripts 条目。
- Tauri 的 notification 2.7、process 2.4 同步更新 Rust crate 和前端包，避免桌面构建因两端 minor 版本不同而失败。
- CodeQL init/analyze 同步到 4.39.1，并配置 Dependabot 分组更新。checkout 更新到 7.0.1 后，发布工作流补丁按完整 SHA 和步骤结构定位，不再绑定旧 SHA；新增回归测试覆盖后续 pin 更新。
- Vite 保留 6；React 插件采用兼容的 5.2.0。插件 6 需要 Vite 8，因此暂缓这项跨打包器迁移，并在 Dependabot 中保留该版本边界。

漏洞来源：[EventSource 内存耗尽](https://github.com/advisories/GHSA-4qv8-2p9j-2685)、[SRI 校验绕过](https://github.com/advisories/GHSA-f72v-6w45-q472)、[content-encodings 拒绝服务](https://github.com/advisories/GHSA-xjj6-f33q-929c)。

## 2026-10-01 更新

- rustls 升级到 0.23.45，修复 RUSTSEC-2026-0285；rustls-webpki 同步到 0.103.15。
- Wrangler 升级到 4.145.0，其依赖 undici 7.29.1 修复 GHSA-w293-vg96-wgc3。原 Dependabot 候选 Wrangler 4.139.0 仍包含受影响版本，因此使用更新的补丁链。
- Workers 类型同步到 5.20261001.1；relay 类型检查、19 项测试和部署 dry-run 均通过。
- 已核对 workerd 1.20260930.2 的安装脚本：选择当前平台的 Cloudflare 二进制，必要时从 npm 获取同一精确版本，并检查二进制版本。仅将该精确版本加入 allowScripts，未扩大脚本授权范围。

漏洞来源：[RustSec](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)、[GitHub Advisory](https://github.com/advisories/GHSA-w293-vg96-wgc3)。

- Vitest and @vitest/mocker: update both npm workspaces to patched 4.1.11 or later.
- sharp/libheif: update Wrangler dependency graph to sharp 0.35.4.
- anyhow RUSTSEC-2026-0190 and event-listener RUSTSEC-2026-0221: update to patched versions (>=1.0.103 and >=5.4.2).
- chacha20: replace the yanked 0.10.1 release with the current compatible patch.
- fflate ZIP64 denial of service: update to 0.8.3.
- glib GHSA-wrw7-89jp-8q8g: source backport in vendor/glib; see its SECURITY-BACKPORT.md. Workspace patch applies to the shipped Tauri application. Publishing a library to crates.io does not propagate workspace patches to consumers; the published CLI/core/web crates do not depend on glib.
- rand RUSTSEC-2026-0097: rand 0.8 is already 0.8.6; remaining 0.7.3 is a build dependency of phf_generator through Tauri utilities. The required log feature is disabled. CI checks the complete resolved feature graph and fails if it becomes enabled. This is a checked non-applicability assessment, not a claim that rand 0.7.3 itself is patched.

GitHub version-based alerts can remain for vendored glib or rand despite these mitigations. Do not dismiss without rechecking the guard and patched-source tests.
