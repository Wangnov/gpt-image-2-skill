# 安全审查报告

审查日期：2026-08-22；修复与上线复核：2026-08-23（Asia/Shanghai）

审查基线：GitHub `main`；生产部署 commit `f3b71fb86e3139f1980b3571ce4c271c616b123e`

范围：GitHub 安全设置、GitHub Actions、Rust workspace、React/Vite/Tauri、Docker Web、Cloudflare relay、npm/Cargo 依赖，以及线上响应头。

## 执行摘要

没有发现已提交的真实密钥，GitHub Secret Scanning 当前也没有未关闭告警。审查时确认的最高风险——生产 Cloudflare relay 作为无认证开放公网代理——已经完成代码修复和生产替换。线上现为 operation-based Relay v2：Turnstile 换取短期签名 HttpOnly 会话，旧 v1 只保留四类固定操作的精确同源兼容。上线后独立探针确认：无 `Origin` 与非法 `Origin` 的 v1 POST 均为 403；无会话的合法同源 v2 操作为 401；配置端点显示 v2 已启用。

原有 9 个 Dependabot 告警已降到 2 个：`glib 0.18.5`（Medium）来自 Linux Tauri/GTK 运行链，`rand 0.7.3`（Low）来自 Tauri HTML 解析构建链。当前 Tauri 兼容依赖没有可直接落地的修复版本，两条均保留为 open、没有 dismiss；`cargo audit` 为 0 个 vulnerability。

生产 Worker 与 Pages 已由 GitHub Actions run `32586116751` 顺序部署成功；Worker 100% 版本的注释精确绑定上述 commit，Pages production deployment 的 source 也为该 commit。生产首页返回 CSP、`frame-ancestors 'none'`、DENY、Permissions Policy、HSTS 与 nosniff；真实 Chrome 页面加载完成且无 warning/error。GitHub 已启用 Dependabot security updates、Actions SHA enforcement 与精确第三方 action allowlist，并为 `main` 强制严格状态检查、PR、管理员执行及对话解决；`cloudflare-production` 环境已增加 reviewer。Cloudflare 现有全局凭据未改动，部署改用独立最小权限 token。

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
- 生产状态：已修复。2026-08-23 上线后，v2 配置、会话状态、v1 非法来源拒绝、v2 无会话拒绝均通过；后台汇总只能证明历史上存在持续调用，不能识别唯一用户，因此保留受限 v1 兼容而没有直接关停。

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
- 生产状态：已修复。静态 Pages 线上响应已复核 CSP、`frame-ancestors 'none'`、Permissions Policy、HSTS、nosniff 与 DENY；Tauri 已启用拒绝远程脚本/对象/Frame/Form 的最小 CSP，并保留 IPC、本地 asset、用户 HTTPS 图片与指定字体来源，Tauri crate 编译通过。

### SEC-004：发布工作流使用可变 action 标签和 pipe-to-shell，且持有发布权限/签名密钥

- Rule ID：CI/CD supply-chain hardening
- 严重度：Medium
- 位置：例如 `.github/workflows/release.yml:63-75`、`.github/workflows/tauri-app-release.yml:81-112`、`.github/workflows/ghcr-publish.yml:145-163`，以及其他 workflow 的 `uses:`。
- 证据：Actions 普遍使用 `actions/checkout@v6`、`dtolnay/rust-toolchain@stable`、`docker/*@vN` 等可移动标签；仓库设置 `sha_pinning_required=false`、`allowed_actions=all`。Release Candidate/Release 还直接执行固定 URL 的安装脚本 `curl ... | sh`。这些 job 中有的可以写 Release、npm/GHCR/Homebrew，并可读取代码签名相关 secrets。
- 影响：上游 action 标签、action 仓库或下载链被攻陷时，攻击者可能接管发布流程、窃取可用凭据或发布被植入的安装包。
- 修复：把第三方与官方 actions 全部固定到完整 commit SHA，并由 Dependabot/Renovate 更新；下载工具后校验 SHA256/签名再执行；把发布 job 的 permissions 与 secrets 拆到最小粒度环境并加 environment approval。
- 缓解：仓库层启用 SHA pinning，限制允许的 actions 到 GitHub-owned 与明确 allowlist。
- False positive notes：可变标签本身不表示当前 action 已被攻陷；这是高价值发布链上的防御缺口。
- 当前状态：已修复。全部外部 Actions 固定到 40 位 commit SHA；cargo-dist 改为仓库内跨平台安装器并固定各平台归档 SHA-256；CI 拒绝可变 Action 引用及远程 pipe-to-shell。仓库后台同时要求 SHA pinning，只允许 GitHub-owned actions 与 7 个精确第三方仓库。

### SEC-009：skill wrapper 将网络下载的可执行归档直接写盘并运行

- Rule ID：`js/http-to-file-access` / release bootstrap integrity
- 严重度：Medium
- 位置：`skills/gpt-image-2-skill/scripts/gpt_image_2_skill.cjs`
- 证据：旧实现对固定 GitHub Release URL 执行 `fetch()`，随后把响应直接 `writeFileSync()` 到临时目录、解包、复制到缓存并执行；没有在落盘/执行前校验 cargo-dist 同步发布的 SHA-256 sidecar，也没有下载体积上限或重定向终点约束。CodeQL 因此产生 1 条 open alert。
- 影响：TLS 或 GitHub 发布资产信任链异常、错误资产或超大响应可能变成本地可执行文件，构成供应链执行与资源耗尽风险。
- 修复：只接受固定 GitHub/release-assets HTTPS 主机和受限资产名；先读取并严格解析同版本 `.sha256`，流式限制 checksum 为 1 KiB、归档为 16 MiB，使用常量时间 SHA-256 比较；校验通过后从内存把归档交给 `tar`，`.tar.xz` 显式使用 `-J` 以兼容 GNU tar，不再把网络响应直接写入归档文件。增加 8 个完整性、格式与负向测试，并用真实 v0.7.3 macOS tar.xz 与 Windows zip 验证解包。
- 当前状态：本次收尾提交已修复；以默认分支 CodeQL 复扫不再报告该数据流作为关闭判据。

### SEC-005：GitHub 安全与合并门禁不完整

- Rule ID：REACT-SUPPLY-001 / repository governance
- 严重度：Medium
- 位置：GitHub repository settings（2026-08-22 实时查询）。
- 证据：Code Scanning API 返回 `no analysis found`；Dependabot Security Updates 为 disabled；`main` 没有 required status checks、required PR review、conversation resolution 或 admin enforcement；Actions SHA pinning 关闭。Secret Scanning 与 push protection 已启用且当前 0 条未关闭告警。
- 影响：静态漏洞缺少持续发现；已知依赖漏洞不会自动生成修复 PR；维护者或凭据被盗后可以绕过 CI/评审直接推送到默认分支。
- 修复：启用 CodeQL（Rust、JavaScript/TypeScript）；启用 Dependabot security updates；要求 CI、至少 1 个 review、conversation resolution，并对管理员执行规则；启用 action SHA pinning。
- 缓解：若单人维护不适合强制 review，至少强制 CI、禁止绕过规则，并为 release environment 设置人工批准。
- False positive notes：以上均来自当前 GitHub API 设置，不涉及推断。
- 当前状态：已修复。Rust、JavaScript/TypeScript 与 GitHub Actions CodeQL 和 `Security` CI 门禁均启用；Dependabot security updates、Actions SHA enforcement、精确 action allowlist、`main` 严格 required checks、PR（单人仓库为 0 强制 approval）、conversation resolution、admin enforcement、禁止 force-push/delete，以及 production Environment reviewer 均已通过 API 回读。CodeQL 新发现的 3 条 Release Candidate workflow 权限告警已通过顶层 `contents: read` 修复，SEC-009 的数据流也已实质修复。

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

### SEC-007：GitHub Dependabot 的残余告警需要按可达性持续跟踪

- Rule ID：REACT-SUPPLY-001
- 严重度：Low 到 High（依赖具体路径）
- 位置：GitHub Dependabot；`Cargo.lock`；两个 npm lockfile。
- 证据与判断：原有 `lettre`、`nanoid`、`undici` 告警已通过兼容升级关闭；当前只剩 `glib 0.18.5`（Linux Tauri GTK 运行时链）和 `rand 0.7.3`（Tauri HTML 解析构建链）两条。项目未调用 advisory 指向的 `glib::VariantStrIter`，rand 路径不进入产品运行时；当前兼容 Tauri 依赖仍固定这些版本。
- 修复：更新 lockfile：`lettre >=0.11.22`、Wrangler/Undici、nanoid 所属父依赖、可升级的 GTK/Tauri 依赖；对不可达告警在完成证据记录后再 dismiss，不要仅凭严重度关闭。
- 缓解：CI 增加 `npm audit` 与 `cargo audit`，并对确认为不可达的 advisory 使用有到期日和理由的审计配置。
- False positive notes：本节明确区分“存在受影响版本”与“本项目路径可利用”。
- 当前状态：Wrangler 已升至 4.125.0、其工具链 `undici` 已升至 7.29.0，两个 npm lockfile 的 `nanoid` 已升至 3.3.18，`lettre` 已升至 0.11.23；当前两个 npm workspace 的 `npm audit` 均为 0。剩余 2 条不做无证据 dismiss，继续由每周 Dependabot 与 CI 跟踪兼容修复。

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
- 生产 Relay v2 采用请求/响应 header allowlist、固定操作、公网 HTTPS 目标校验、Cloudflare 公网出站限制、逐级重定向复验和请求/响应流上限。
- CI 使用 lockfile + `npm ci`；GitHub 默认 workflow token 权限为 read，不能批准 PR。

## 上游残余风险（未静默忽略）

2026-08-23 使用最新 RustSec advisory database 复核时，`cargo audit` 为 0 个 vulnerability，另有 17 条 unmaintained 与 4 条 unsound 信息性警告。它们均没有当前可用的兼容修复：GTK3 系列是 Tauri 2.11.5 在 Linux 上的 WebKit 运行时；`anyhow 1.0.102`、`event-listener 5.4.1` 均是当前可选最新版；`glib 0.18.5` 由 Linux Tauri 链引入；`rand 0.7.3` 只在 Tauri HTML 解析构建链中出现。项目未调用 advisory 指向的 `anyhow::Error::downcast_mut` 或 `glib::VariantStrIter`，rand 路径也不进入产品运行时。

这些项目没有写入 `audit.toml` ignore，也没有在 GitHub 告警中 dismiss。CI 每次运行 `cargo audit`，Dependabot 每周检查 Cargo 与 Actions；上游一旦发布兼容修复，门禁会把升级变成明确改动。Linux 桌面端仍应把系统 WebKit/GTK 安全更新视为部署前置条件。

## 后续维护顺序

1. 不得把 Relay 回退到 open/report-only；每次生产变更继续执行 v2 配置、v1 来源拒绝、v2 无会话拒绝及安全响应头探针。
2. 在具备中国大陆与海外真实网络出口时补做双地域 canary；本次只完成单一出口的真实 Chrome 加载，不能据此声称覆盖全部地区。
3. 持续跟进 Tauri 平台依赖中的 GTK3、`glib`、`rand`、`anyhow` 与 `event-listener`；兼容修复出现后立即升级，不以 ignore/dismiss 代替处理。
4. GitHub 当前套餐不支持或未开放 Secret Scanning non-provider patterns 与 validity checks，保持 provider secret scanning + push protection，并在能力可用后再启用这两项。

## 验证方法

- GitHub API：repository security settings、Dependabot/Code/Secret Scanning、Actions permissions、main branch protection。
- 依赖：`npm audit --omit=dev`、relay 全量 `npm audit`、`cargo audit --json`、`cargo tree -i ... --target all`。
- 静态扫描：React/DOM sink、storage/token、网络目标、Tauri capability/CSP、GitHub workflow 权限与 action 引用。
- 线上只读验证：生产页面 HTTP 响应头；v2 config/session；v1 无 Origin/非法 Origin POST；v2 合法同源但无会话请求；Cloudflare Worker 与 Pages commit 绑定；真实 Chrome DOM、视觉与控制台状态。
