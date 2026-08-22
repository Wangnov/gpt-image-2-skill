# 安全审查报告

审查日期：2026-08-22；修复复核：2026-08-23（Asia/Shanghai）  
审查基线：GitHub `main`，commit `49b0a6b8e6692869027f9ffd39d6b8240a6b50cc`  
范围：GitHub 安全设置、GitHub Actions、Rust workspace、React/Vite/Tauri、Docker Web、Cloudflare relay、npm/Cargo 依赖，以及线上响应头。

## 执行摘要

没有发现已提交的真实密钥，GitHub Secret Scanning 当前也没有未关闭告警。最需要立即处理的是生产 Cloudflare relay 仍以 `open` 模式运行：未带 `Origin` 的任意客户端无需认证即可让它访问任意公网 HTTPS 地址。线上实测已通过该 relay 成功获取 `https://example.com/`，响应明确返回 `x-gpt-image-2-relay-policy: open`。这使项目承担公开代理滥用、Cloudflare 配额/费用和来源信誉风险。

GitHub 当前有 9 个未关闭的 Dependabot 告警，但应按本项目可达性重新排序：`lettre` 的 Critical 告警只影响 `boring-tls`，本项目明确启用 `rustls`，因此不是当前可利用的 Critical；`undici` 位于 Wrangler 开发依赖链；`nanoid` 位于构建工具链。与此同时，`cargo audit` 发现 GitHub 列表尚未显示的 `h2` 与多个 `quick-xml` 告警。

本报告保留审查时的生产基线证据。`codex/relay-v2-security` 已完成 operation-based Relay v2、受限 v1、Turnstile 会话、限速和 SSRF 纵深防御，也已处理可升级的 Rust 漏洞、Pages/Tauri CSP、GitHub Actions SHA pinning、CodeQL/Dependabot 配置与 Docker Web 会话安全。截至 2026-08-23 的本地复核，两个 npm workspace 均为 0 漏洞，`cargo audit` 为 0 个 vulnerability；生产部署和 GitHub 仓库级设置仍须在合并后验证，不能把本地通过表述为线上已修复。

## High

### SEC-001：生产 relay 是无认证的开放公网代理

- Rule ID：REACT-NET-001 / 服务端访问控制
- 严重度：High
- 位置：`workers/gpt-image-2-relay/wrangler.jsonc:18-25`；`workers/gpt-image-2-relay/src/index.ts:121-125, 201-230, 299-357`
- 证据：部署配置设置 `RELAY_MODE="open"`、`RELAY_ALLOWLIST_REPORT_ONLY="true"`；`originAllowed()` 对没有 `Origin` 的请求直接返回 `true`；服务端只限制 HTTPS、端口和显式私网 IP，随后将请求转发到调用者指定的任意公网主机。
- 线上验证：无 `Origin`、无认证的 POST 请求可代理 GET `https://example.com/`，返回 HTTP 200、Example Domain 页面，以及 `x-gpt-image-2-relay-policy: open`。
- 影响：任意脚本或机器人可借项目域名做代理、消耗 50 MiB 请求/120 MiB 响应额度、隐藏来源并损害域名/IP 信誉。CORS 只约束浏览器读取响应，不是服务端访问控制；命令行客户端可完全绕过。
- 修复：不枚举用户上游域名，改为 operation-based Relay：服务端只拼接模型检查、生成、编辑三个固定路径和无凭证图片下载；通过 Turnstile 换取短期签名 HttpOnly 会话，并叠加精确 Origin、Fetch Metadata、Cloudflare Rate Limiting、请求大小与公网 HTTPS/重定向校验。旧入口只保留同样四类操作的受限兼容；删除 `RELAY_MODE=open`，且绝不把 `Origin` 当作唯一认证信号。
- 缓解：修复发布前，先在 Cloudflare WAF/Worker route 层限制请求速率、请求体大小和允许的上游；监控异常目的域名、出站字节和 4xx/5xx。
- False positive notes：不是误报；已对生产端点做最小化只读验证并成功代理公开测试站点。
- 本分支状态：已实现并通过 Worker/前端安全测试与 Wrangler dry-run，生产 Turnstile、灰度和部署结果见最终上线记录；在上线验证完成前，本条仍按生产未修复处理。

## Medium

### SEC-002：Rust HTTP/2 依赖存在可导致内存耗尽的 `h2` 漏洞

- Rule ID：RUSTSEC-2026-0258 / GHSA-q83h-524g-xf6h
- 严重度：Medium
- 位置：`Cargo.lock` 中 `h2 0.4.13`；反向依赖包含 `axum -> gpt-image-2-web`、`reqwest -> gpt-image-2-core`。
- 证据：`cargo audit` 报告 `h2 0.4.13` 可无限排队空 DATA frame，修复版本为 `>=0.4.16`。
- 影响：若 Docker Web 的 HTTP/2 连接直接暴露或反向代理向后端保留可攻击的 HTTP/2 流量，远程客户端可能造成内存增长或 panic。客户端侧恶意 HTTP/2 peer 也可能影响使用 `reqwest` 的路径。
- 修复：更新 lockfile 使 `h2 >=0.4.16`，运行 workspace 测试与 Docker Web 冒烟测试。
- 缓解：在反向代理限制连接/流并设置资源上限；在升级前避免直接暴露 h2c。
- False positive notes：是否能从当前生产拓扑直达 h2 需要结合反向代理协议确认，但受影响依赖确实进入运行时图。
- 本分支状态：已升至 `h2 0.4.16`，workspace Clippy、测试及 Docker Web 签名会话集成探针通过，`cargo audit` 不再报告该漏洞。

### SEC-003：Web 与 Tauri 都缺少 CSP，线上页面也缺少点击劫持等响应头

- Rule ID：REACT-CSP-001 / REACT-HEADERS-001
- 严重度：Medium
- 位置：`apps/gpt-image-2-app/src-tauri/tauri.conf.json:29-39`；`apps/gpt-image-2-app/index.html:1-25`
- 证据：Tauri 配置明确为 `"csp": null`，同时启用了 `assetProtocol`，范围包括 `$APPDATA/**`、`$PICTURE/**`、`$HOME/.codex/gpt-image-2-skill/**`、`$TEMP/**`。HTML 没有 CSP。2026-08-22 实测 `https://image.codex-pool.com/` 与 Pages 域名均没有 `Content-Security-Policy`、`X-Frame-Options` 或 `Permissions-Policy`；已有 `nosniff` 和 `Referrer-Policy`。
- 影响：当前 React 扫描未发现已证实的 XSS sink，但一旦未来依赖或渲染路径出现 XSS，缺少 CSP 会扩大浏览器与桌面 WebView 中的影响；桌面端可读取较宽的本地 asset scope，风险更高。
- 修复：为 Tauri 配置最小可用 CSP；为 Cloudflare Pages/自托管 Web 设置响应头 CSP（至少严格 `script-src`）、`frame-ancestors 'none'`、`Permissions-Policy`。字体来源应精确允许，避免 `unsafe-eval`/`unsafe-inline`。
- 缓解：缩小 asset protocol scope；继续避免 `dangerouslySetInnerHTML`、动态脚本和任意 URL sink。
- False positive notes：线上头部已验证，不是“仓库中不可见”的推断。
- 本分支状态：静态 Pages 已新增并构建验证 CSP、`frame-ancestors 'none'`、Permissions Policy、HSTS、nosniff、DENY 等响应头；Tauri 已启用拒绝远程脚本/对象/Frame/Form 的最小 CSP，并保留 IPC、本地 asset、用户 HTTPS 图片与指定字体来源。Tauri crate 编译通过；生产 Pages 仍需部署后验头。

### SEC-004：发布工作流使用可变 action 标签和 pipe-to-shell，且持有发布权限/签名密钥

- Rule ID：CI/CD supply-chain hardening
- 严重度：Medium
- 位置：例如 `.github/workflows/release.yml:63-75`、`.github/workflows/tauri-app-release.yml:81-112`、`.github/workflows/ghcr-publish.yml:145-163`，以及其他 workflow 的 `uses:`。
- 证据：Actions 普遍使用 `actions/checkout@v6`、`dtolnay/rust-toolchain@stable`、`docker/*@vN` 等可移动标签；仓库设置 `sha_pinning_required=false`、`allowed_actions=all`。Release Candidate/Release 还直接执行固定 URL 的安装脚本 `curl ... | sh`。这些 job 中有的可以写 Release、npm/GHCR/Homebrew，并可读取代码签名相关 secrets。
- 影响：上游 action 标签、action 仓库或下载链被攻陷时，攻击者可能接管发布流程、窃取可用凭据或发布被植入的安装包。
- 修复：把第三方与官方 actions 全部固定到完整 commit SHA，并由 Dependabot/Renovate 更新；下载工具后校验 SHA256/签名再执行；把发布 job 的 permissions 与 secrets 拆到最小粒度环境并加 environment approval。
- 缓解：仓库层启用 SHA pinning，限制允许的 actions 到 GitHub-owned 与明确 allowlist。
- False positive notes：可变标签本身不表示当前 action 已被攻陷；这是高价值发布链上的防御缺口。
- 本分支状态：全部外部 Actions 已固定到 40 位 commit SHA；cargo-dist 改为仓库内跨平台安装器并固定各平台归档 SHA-256；CI 新增检查，拒绝可变 Action 引用及远程 pipe-to-shell。

### SEC-005：GitHub 安全与合并门禁不完整

- Rule ID：REACT-SUPPLY-001 / repository governance
- 严重度：Medium
- 位置：GitHub repository settings（2026-08-22 实时查询）。
- 证据：Code Scanning API 返回 `no analysis found`；Dependabot Security Updates 为 disabled；`main` 没有 required status checks、required PR review、conversation resolution 或 admin enforcement；Actions SHA pinning 关闭。Secret Scanning 与 push protection 已启用且当前 0 条未关闭告警。
- 影响：静态漏洞缺少持续发现；已知依赖漏洞不会自动生成修复 PR；维护者或凭据被盗后可以绕过 CI/评审直接推送到默认分支。
- 修复：启用 CodeQL（Rust、JavaScript/TypeScript）；启用 Dependabot security updates；要求 CI、至少 1 个 review、conversation resolution，并对管理员执行规则；启用 action SHA pinning。
- 缓解：若单人维护不适合强制 review，至少强制 CI、禁止绕过规则，并为 release environment 设置人工批准。
- False positive notes：以上均来自当前 GitHub API 设置，不涉及推断。
- 本分支状态：已新增 Rust/JavaScript/TypeScript/GitHub Actions CodeQL、四类 Dependabot 更新和 `Security` CI 门禁。Dependabot security updates、Actions SHA enforcement、main 分支保护和 Environment reviewer 属于 GitHub 后台状态，须在合并后通过 API 启用并复核。

### SEC-006：HTTPS 部署时 session cookie 没有 `Secure`

- Rule ID：session cookie hardening
- 严重度：Medium（仅影响通过 HTTPS 暴露且 HTTP 仍可达的部署）
- 位置：`crates/gpt-image-2-web/src/auth.rs:205-221`
- 证据：cookie 包含 `HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600`，但没有 `Secure`；cookie 值本身就是共享访问 token，并保存 14 天。
- 影响：若同一主机仍可通过明文 HTTP 访问，浏览器可在 HTTP 请求中发送该 cookie，网络路径上的攻击者可窃取完整共享 token。
- 修复：增加显式的外部 HTTPS/secure-cookie 配置，在 TLS 终止于反向代理时设置 `Secure`；生产文档要求 HTTPS，并考虑让 session 使用独立随机值而不是直接复制长期共享 token。
- 缓解：HTTP 强制跳转到 HTTPS；防火墙关闭明文端口；缩短 cookie 生命周期并支持注销/轮换。
- False positive notes：纯本机 HTTP 开发环境不能无条件加 `Secure`，因此应按部署模式控制。
- 本分支状态：浏览器 Cookie 已改为 12 小时 HMAC 签名会话，不再复制共享 token；`GPT_IMAGE_2_WEB_SECURE_COOKIE=1` 为 HTTPS 部署追加 `Secure`，TTL 可在 5 分钟至 7 天内配置，token 轮换会立即使旧会话失效。单元测试与真实本机 HTTP 集成探针均通过。

## Low / 依赖可达性待确认

### SEC-007：GitHub Dependabot 的 9 条告警需要清理，但严重度不能照单全收

- Rule ID：REACT-SUPPLY-001
- 严重度：Low 到 High（依赖具体路径）
- 位置：GitHub Dependabot；`Cargo.lock`；两个 npm lockfile。
- 证据与判断：
  - `lettre 0.11.21`：GitHub 标 Critical，修复为 0.11.22；但漏洞仅影响 `boring-tls`。`crates/gpt-image-2-core/Cargo.toml:21` 明确启用 `rustls`，实际不可利用性高，仍应升级以关闭告警。
  - `nanoid <3.3.18`：1 条 High，位于前端构建依赖链；漏洞要求调用自定义生成器且传入 size 0，目前未发现项目代码调用。
  - `undici 7.28.0`：1 High + 4 Medium，均经 Wrangler/Miniflare 开发依赖链进入；生产 Worker 使用 Cloudflare 原生 `fetch`，未发现项目直接调用这些受影响 API。升级 Wrangler 仍是正确处理。
  - `glib 0.18.5`：1 Medium，Linux Tauri GTK 运行时依赖；项目自身未使用 `VariantStrIter`，触发性待上游/平台路径确认。
  - `rand 0.7.3`：1 Low，构建依赖链；漏洞需要 `log` + `thread_rng` + 自定义 logger 重入等组合，当前 feature tree 未显示 `log`，实际不可达。
- 修复：更新 lockfile：`lettre >=0.11.22`、Wrangler/Undici、nanoid 所属父依赖、可升级的 GTK/Tauri 依赖；对不可达告警在完成证据记录后再 dismiss，不要仅凭严重度关闭。
- 缓解：CI 增加 `npm audit` 与 `cargo audit`，并对确认为不可达的 advisory 使用有到期日和理由的审计配置。
- False positive notes：本节明确区分“存在受影响版本”与“本项目路径可利用”。
- 本分支状态：Wrangler 已升至 4.125.0、其工具链 `undici` 已升至 7.29.0，两个 npm lockfile 的 `nanoid` 已升至 3.3.18，`lettre` 已升至 0.11.23；当前两个 npm workspace 的 `npm audit` 均为 0，并显式允许必要的 `esbuild`/`workerd` install script、拒绝可选 `fsevents`。GitHub 告警要等改动进入默认分支后重新计算。

### SEC-008：`cargo audit` 另报多个 `quick-xml` DoS，主要位于平台/构建依赖链

- Rule ID：RUSTSEC-2026-0194 / RUSTSEC-2026-0195
- 严重度：Low（当前项目可达性未证实）
- 位置：`Cargo.lock` 中 `quick-xml 0.37.5`、`0.38.4`、`0.39.3`。
- 证据：三套版本均低于 0.41.0，分别经 Windows notification、Tauri plist、Wayland scanner 链进入；项目源代码未直接使用 `quick_xml`、`NsReader` 或 attributes API。
- 影响：只有在相关上游组件解析攻击者可控 XML 并走受影响 API 时才会造成 CPU/内存耗尽；当前未证实这样的输入路径。
- 修复：跟进上游 Tauri/notification/Wayland 依赖升级，尽量统一到 `quick-xml >=0.41.0`；记录无法立即升级的原因。
- False positive notes：`cargo audit` 按 lockfile 报告，不会自动判断目标平台、build dependency 或 API 可达性。
- 本分支状态：`plist 1.10.0` 与 `wayland-scanner 0.31.11` 已统一到 `quick-xml 0.41.0`；`tauri-winrt-notification 0.7.3` 已移除其 quick-xml 依赖。锁文件不再包含受影响的 quick-xml 版本。

## 已确认的积极控制

- Secret Scanning 和 push protection 已启用，当前无未关闭 secret alert。
- Docker Web 在非 loopback 绑定且无 token 时默认拒绝启动；API 包含 Host 检查、常量时间 token 比较、HttpOnly + SameSite=Strict cookie。
- Tauri updater 使用公钥签名校验，macOS 开启 hardened runtime。
- React 扫描未发现 `dangerouslySetInnerHTML`、`eval`、`document.write` 或不安全 `postMessage` 处理。
- 新 Relay v2 分支采用请求/响应 header allowlist、固定操作、公网 HTTPS 目标校验、Cloudflare 公网出站限制、逐级重定向复验和请求/响应流上限；生产环境仍是报告前述旧版本，需完成灰度后才能把该项视为线上控制。
- CI 使用 lockfile + `npm ci`；GitHub 默认 workflow token 权限为 read，不能批准 PR。

## 上游残余风险（未静默忽略）

2026-08-23 使用最新 RustSec advisory database 复核时，`cargo audit` 为 0 个 vulnerability，另有 17 条 unmaintained 与 4 条 unsound 信息性警告。它们均没有当前可用的兼容修复：GTK3 系列是 Tauri 2.11.5 在 Linux 上的 WebKit 运行时；`anyhow 1.0.102`、`event-listener 5.4.1` 均是当前可选最新版；`glib 0.18.5` 由 Linux Tauri 链引入；`rand 0.7.3` 只在 Tauri HTML 解析构建链中出现。项目未调用 advisory 指向的 `anyhow::Error::downcast_mut` 或 `glib::VariantStrIter`，rand 路径也不进入产品运行时。

这些项目没有写入 `audit.toml` ignore，也没有在 GitHub 告警中 dismiss。CI 每次运行 `cargo audit`，Dependabot 每周检查 Cargo 与 Actions；上游一旦发布兼容修复，门禁会把升级变成明确改动。Linux 桌面端仍应把系统 WebKit/GTK 安全更新视为部署前置条件。

## 建议修复顺序

1. 按 `docs/relay-security-runbook.md` 配置 Turnstile/会话 secret，先部署向后兼容 Worker并做负向探针，再发布 v2 前端；不得回退到 open/report-only。
2. 用真实浏览器完成可直连与必须 Relay 两条 canary，确认未知结果的生成 POST 不会自动重放；随后检查无敏感字段的后台路径/状态码汇总。
3. 合并后启用 CodeQL、Dependabot security updates、main 分支 CI 门禁、Actions SHA enforcement 和 production Environment reviewer，并通过 API 回读结果。
4. 持续跟进 Tauri 平台依赖中的 GTK3、`glib`、`anyhow` 与 `event-listener`；兼容修复出现后立即升级，不以 ignore/dismiss 代替处理。

## 验证方法

- GitHub API：repository security settings、Dependabot/Code/Secret Scanning、Actions permissions、main branch protection。
- 依赖：`npm audit --omit=dev`、relay 全量 `npm audit`、`cargo audit --json`、`cargo tree -i ... --target all`。
- 静态扫描：React/DOM sink、storage/token、网络目标、Tauri capability/CSP、GitHub workflow 权限与 action 引用。
- 线上只读验证：两个页面的 HTTP 响应头；relay 的无 Origin/非法 Origin行为；通过 relay 获取 `https://example.com/`。
