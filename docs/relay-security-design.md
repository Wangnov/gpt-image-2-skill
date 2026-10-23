# 公共 Relay v2 安全设计

状态：代码已实施，尚未部署生产；上线门禁见 [`relay-security-runbook.md`](relay-security-runbook.md)  
日期：2026-08-22  
适用范围：`image.codex-pool.com` 静态 Web 与 `gpt-image-2-relay` Cloudflare Worker

## 1. 决策摘要

生产环境不采用“中转站域名白名单”作为主要边界。用户可以继续填写任意公网 OpenAI-compatible API Base；系统限制的是 Relay 可执行的操作，而不是提前枚举域名。

推荐方案是：

1. 浏览器先用无副作用的 `/models` 请求探测传输能力，并按 Provider 记住 `direct` 或 `relay`；确认可以直连时不经过我们的 Worker。
2. 探测发生 CORS 网络失败时，静态 Web 才为后续生成/编辑选择 Relay。状态不明的生成/编辑 POST 不允许自动换通道重试，避免重复扣费。
3. Relay 不再接受任意 URL、任意路径和任意方法，而只提供四种产品实际需要的能力：测试模型接口、图片生成、图片编辑、结果图片下载。
4. 首次使用 Relay 时，通过 Cloudflare Turnstile 换取短期、HttpOnly 的匿名会话；Worker 同时校验同源请求并按会话限速。
5. API Key、提示词和图片只流经内存转发，不保存到 Relay；API Key 不写入日志，也不用于会话或限速标识。
6. 无法满足该协议的非标准服务，继续由桌面 App 或 Docker 直连，不为它们重新开放通用公网代理。

这套设计保留任意中转站域名，同时把当前的“匿名通用 HTTPS 代理”收缩为“经过人机验证、限速、只会调用图片 API 的能力代理”。

## 2. 为什么不用其他方案

| 方案                         | 任意域名兼容 | 防滥用能力 | 结论                                 |
| ---------------------------- | ------------ | ---------- | ------------------------------------ |
| 枚举上游域名白名单           | 差           | 强         | 不符合产品需求                       |
| 在前端内置 Relay 密钥        | 好           | 无         | 浏览器中的密钥必然可提取，拒绝       |
| 只检查 `Origin`              | 好           | 弱         | 非浏览器客户端可以伪造，不能作为认证 |
| 保持开放代理，仅阻止内网 IP  | 好           | 弱         | 仍可代理任意公网请求，拒绝           |
| 操作级协议 + 匿名会话 + 限速 | 好           | 较强       | 推荐                                 |
| 完全取消 Web Relay           | 差           | 最强       | 作为紧急关闭和桌面/Docker 兜底       |

OWASP 将“目标域名预先未知”的场景单独归类：此时域名 allowlist 不成立，需要结合输入约束、公共网络边界和滥用控制做纵深防御。参见 [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html#case-2-application-can-send-requests-to-any-external-ip-address-or-domain-name)。

## 3. 当前事实与兼容约束

### 3.1 实施前代码路径（迁移基线）

- `apps/gpt-image-2-app/src/lib/api/browser/openai.ts` 实施前会先直接 `fetch(endpoint)`；疑似 CORS 网络失败时再调用 `/api/relay`。
- 静态 Web 只支持 OpenAI-compatible Provider，实际调用路径是 `/models`、`/images/generations` 和 `/images/edits`。
- API Key 当前通过 `Authorization: Bearer ...` 转发；生成结果若返回 URL，浏览器还可能通过 Relay 下载图片。
- 当前 direct-first 对有副作用的 POST 存在一个兼容风险：请求可能已被上游处理，但响应因 CORS 或断网不可见，随后 Relay 重试会导致重复生成/扣费。v2 必须用无副作用探测提前选择通道，并把“结果未知”与“确定失败”分开。
- 浏览器队列默认并发为 2；单个不支持 `n` 的 Provider 最多会并发拆出 16 个子请求，因此限速不能按普通表单接口设置得过低。
- 桌面 App、Docker 和 CLI 有自己的服务端/本地 HTTP 客户端，不依赖这个公共 Relay。

### 3.2 生产流量基线

2026-07-23 至 2026-08-22 的 Worker 后台数据，在排除本次审计请求后为：

- 65 次调用，分布在 23 个自然日；
- 54 次成功、10 次异常、1 次客户端中断；
- 单分钟历史峰值为 5 次，单日峰值为 8 次；
- 已确认的真实请求使用标准 `/v1/images/generations` 或 `/v1/images/edits` 路径；近期真实请求体约为 669 B、126 KiB 和 5.9 MiB，均远低于当前 50 MiB 上限。

因此这是低流量但有真实用户的生产服务。迁移必须兼容标准图片接口，不能直接关闭或突然启用域名白名单。

### 3.3 本次实施结果

- Worker 已拆分为 `config.ts`、`policy.ts`、`session.ts`、`streams.ts`、`types.ts` 与路由入口 `index.ts`。
- 前端新增 `relay-client.ts`，以 `/models` 安全探测选择传输，并阻止状态不明的生成/编辑 POST 自动重放。
- v2 已强制 Turnstile 会话、固定操作、同源与 Fetch Metadata、三个独立限流绑定、SSRF 校验、大小上限和 header allowlist。
- v1 已从开放代理改为受限兼容，只接受模型检查、生成、编辑和无凭证 asset 下载。
- Pages 已增加 CSP/安全头；Release workflow 已固定为 secret 检查、Worker-first、线上 v2 readiness、Pages-last。
- 这些改动只在本地分支完成；尚未部署 Worker 或 Pages，也未改变当前生产行为。

## 4. 安全目标和非目标

### 4.1 必须达到

- 不需要预知用户选择的 API 域名。
- 未经授权的脚本不能把 Relay 当作任意 URL/方法的通用代理。
- Relay 不能访问显式的本机、私网、链路本地或特殊用途地址。
- 跳转不能绕过目标检查。
- 用户 API Key、提示词、上传图片和带签名的下载 URL 不得进入应用日志。
- 单个客户端不能无上限消耗 Worker 请求、入站流量和出站流量。
- 安全控制失败时必须关闭 Relay 请求，不能静默退回开放模式。
- 正常用户可以识别“上游错误”“Relay 策略拒绝”“限流”和“人机验证失败”，避免把所有问题都误报成 CORS。

### 4.2 明确不承诺

- Relay 无法判断一个任意第三方 API 是否诚实；用户主动配置的上游仍能看到其 API Key、提示词和图片。
- Turnstile 与限速提高滥用成本，但不能绝对阻止分布式真人或 Bot 网络。
- 静态 Web 无法安全支持任意自定义 HTTP 方法、任意路径、任意请求头和非标准端口；这些高级场景应使用桌面 App 或 Docker。
- 本设计不把浏览器 IndexedDB 变成密钥保险箱。静态 Web 的 API Key 仍属于浏览器可访问数据，需要 CSP、无 XSS 和明确的用户提示共同保护。

## 5. 威胁模型

### 5.1 需要保护的资产

- 用户的上游 API Key、提示词、参考图片和生成结果；
- 用户上游账户的调用额度；
- Cloudflare Worker 配额、带宽、账单与域名信誉；
- 生产站点可用性；
- 后台日志中可能出现的上游地址与请求元数据。

### 5.2 攻击者

- 不访问网页、直接用脚本调用 `/api/relay` 的匿名攻击者；
- 能伪造 `Origin`、User-Agent 等浏览器头的程序；
- 诱导用户打开恶意网页的攻击者；
- 返回恶意重定向、超大响应或伪造内容类型的上游；
- 已经通过 Turnstile、但试图滥用服务的客户端；
- 利用未来前端 XSS 读取浏览器内 API Key 的攻击者。

### 5.3 关键结论

`CORS` 和 `Origin` 只能限制正常浏览器，不能认证命令行或 Bot。前端固定密钥也不是秘密。真正的安全边界必须在 Worker 内由“短期会话 + 固定操作 + 请求约束 + 限速”共同建立。

## 6. 目标架构

```text
静态 Web
  │
  ├─ 1. 用 /models 无副作用探测任意 HTTPS API Base ─> 用户上游
  │       └─ 可达：记住 direct，生成/编辑均直连
  │
  └─ 2. 探测确认 CORS/网络层不可直连时，记住 relay
          │
          ├─ 懒加载 Turnstile，换取匿名 HttpOnly 会话
          │
          └─ 调用 Relay v2 的固定操作
                 │
                 ├─ 会话、Origin、Fetch Metadata 校验
                 ├─ 会话级与应急 IP 级限速
                 ├─ URL/方法/路径/头/大小/跳转校验
                 ├─ 只构造产品允许的上游请求
                 └──────────────────────────────────> 任意公网 HTTPS API Base

桌面 App / Docker / CLI ── 本地或自托管客户端直连 ──> 用户上游
```

## 7. Relay v2 协议

### 7.1 公共配置

`GET /api/relay/v2/config`

只返回公开信息：

```json
{
  "version": 2,
  "enabled": true,
  "auth_mode": "turnstile",
  "turnstile_site_key": "<public-site-key>",
  "session_ttl_seconds": 86400,
  "operations": ["models", "generations", "edits", "asset"]
}
```

要求：

- 不返回任何 Worker secret、内部规则或限速 key；
- `Cache-Control: no-store`，避免 kill switch、secret 缺失或 readiness 变化被缓存；
- 可通过 `enabled=false` 向前端提供明确的紧急关闭状态。

### 7.2 匿名会话

`POST /api/relay/v2/session`

请求体仅包含一次性 Turnstile token。Worker 必须调用 Siteverify 服务端验证，并校验返回的 `hostname` 与 `action`。Turnstile token 五分钟过期且只能使用一次，不能只在前端显示组件而跳过服务端验证。参见 [Cloudflare Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。

验证成功后设置：

```text
Set-Cookie: __Host-gpt2_relay=<signed-token>;
            Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Strict
```

签名 token 只包含：协议版本、128-bit 随机会话 ID、签发时间和到期时间。使用 Worker secret 中的 HMAC-SHA-256 密钥签名；不包含 API Key、上游域名、IP 或用户身份。

规则：

- 会话只在真正需要 Relay 时懒创建；
- 前端对并发的 `ensureRelaySession()` 做 Promise 去重，避免一个 16 图批次触发 16 次验证；
- 会话过期时只重试一次，不允许无限刷新；
- HMAC 密钥支持当前值和前一值的短期双读，以便无中断轮换；
- Turnstile/Siteverify 不可用时返回结构化 `503 relay_auth_unavailable`，不得自动放行。

### 7.3 固定操作

| 外部端点                         | 上游行为                             | API Key      | 典型上限                          |
| -------------------------------- | ------------------------------------ | ------------ | --------------------------------- |
| `POST /api/relay/v2/models`      | `GET <api-base>/models`              | 转发         | 响应 2 MiB，15 秒                 |
| `POST /api/relay/v2/generations` | `POST <api-base>/images/generations` | 转发         | 请求 1 MiB，响应 120 MiB，300 秒  |
| `POST /api/relay/v2/edits`       | `POST <api-base>/images/edits`       | 转发         | 请求 50 MiB，响应 120 MiB，300 秒 |
| `POST /api/relay/v2/asset`       | `GET <signed-image-url>`             | **绝不转发** | 请求 8 KiB，响应 32 MiB，60 秒    |

前三个端点通过 `X-GPT-Image-2-Api-Base` 接收 API Base，而不是任意最终 URL。Worker 自己拼接固定后缀。`asset` 的带签名完整 URL 放在很小的 JSON 请求体里，避免 Cloudflare 自动请求日志记录自定义头时把签名查询参数写入日志。

禁止继续支持：

- 由客户端指定上游 method；
- 任意 API path；
- 把上游 URL 中的用户名、密码、query 或 fragment 当成 API Base；
- 向 asset 下载请求转发 `Authorization`；
- WebSocket、CONNECT、HTTP 或非 443 端口。

### 7.4 请求头策略

从“黑名单删除危险头”改为“白名单复制必要头”。

API 操作最多允许转发：

- `Authorization`
- `Accept`
- `Content-Type`

禁止转发：

- `Cookie`、`Origin`、`Referer`
- `Host`、`Connection`、`Transfer-Encoding`
- `CF-*`、`X-Forwarded-*`、`X-Real-IP`
- 所有 `X-GPT-Image-2-*` 内部协议头

响应只复制安全的内容头和 Provider 的诊断 ID；始终删除 `Set-Cookie`，增加 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、Relay 标记和策略版本。

## 8. 目标 URL 与 SSRF 防护

### 8.1 API Base 规范化

只接受满足全部条件的 API Base：

- `https:`；
- 默认 443 端口；
- 没有 username/password、query、fragment；
- hostname 经过 WHATWG URL 解析和 IDNA 规范化；
- 拒绝所有 IPv4/IPv6 literal，包括十进制、八进制、十六进制和混合写法；
- 拒绝 `localhost`、`*.localhost`、`*.local`、`*.internal`、`home.arpa` 等特殊名称；
- 拒绝 Relay 自己的生产 hostname 和 Pages hostname，避免递归回源；
- 路径长度有限，拒绝控制字符、反斜杠、编码后的 `/`、`\`、`.`/`..` 绕过形式；
- 整个值不超过 2 KiB。

Worker 只在规范化后的 Base 后追加固定路径，不允许客户端控制拼接后的 operation path。

### 8.2 网络层

- Wrangler 启用 `global_fetch_strictly_public` compatibility flag，使全局 `fetch()` 始终按公共互联网入口路由；参见 [Cloudflare compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)。
- 不给 Worker 配置通向内部服务的 Service Binding、Cloudflare Tunnel 私网路由或其他私网能力。
- 应用层继续拒绝显式私网/保留地址，但不依赖一次“先 DNS 解析、后 fetch”的自制校验，因为这会产生 DNS rebinding/TOCTOU 窗口。
- API 操作使用 `redirect: "manual"`，任何 3xx 原样作为错误返回，不跟随。
- asset 最多允许两次 GET 跳转；每一级都重新执行完整 URL 策略，且始终不携带 Authorization、Cookie 或 Referer。

### 8.3 内容与流量限制

- 先检查 `Content-Length`，缺失或分块传输时仍用计数 TransformStream 约束真实读取字节；不能只相信客户端头。
- 响应同样流式计数，超过限制时立即取消上游 reader。
- `models`、`generations`、`edits` 的成功响应要求 JSON-compatible Content-Type；非 2xx 错误允许有限大小的文本/JSON，便于向用户显示 Provider 错误。
- `asset` 的 2xx 响应只接受 `image/*` 或明确兼容的 `application/octet-stream`；不把 HTML 伪装成图片返回给应用。
- 每个上游请求使用 `AbortSignal.timeout()`；浏览器取消任务时向上游传播 abort。
- 当前代码每个 API 请求只发一个上游 subrequest，asset 最多两次重定向，另由操作超时和流量上限约束；若生产套餐支持额外的 CPU/subrequest 配额控制，再按 canary 数据收紧，不能在缺少真实长任务数据时直接设得过低。参见 [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)。

## 9. 访问控制与限速

### 9.1 每次 Relay 请求必须同时通过

1. 路径和外层 HTTP method 正确；
2. `Origin` 精确等于生产站点；
3. `Sec-Fetch-Site` 为 `same-origin`（作为纵深防御，不单独作为认证）；
4. `__Host-gpt2_relay` 会话签名、版本和有效期正确；
5. 会话级限速通过；
6. URL、操作、头、请求体和响应策略通过。

生产 v2 不接受“没有 Origin 但可能是 CLI”的例外。CLI、桌面和 Docker 本来就不需要公共 Relay。

### 9.2 建议阈值

初始值根据现有流量和浏览器最大批次设置：

- 会话创建：同一网络来源 10 次/分钟，超出后 429；
- 普通 Relay：同一会话 120 次/分钟，以覆盖两个并行任务各 16 次生成请求和 16 次图片下载的合法峰值；
- 受限 v1：同一网络来源 80 次/分钟；WAF 可另设更宽松的 IP 应急兜底；
- 全局告警：超过 1,000 次/日或出站字节显著偏离基线时通知并可自动切换 kill switch；
- 5 分钟内高比例 401/403/404/5xx 或持续触发大小限制时，把该会话升级为重新验证或临时封禁；跨请求自动风控若需要精确状态，应另行使用 Durable Object，不能假装无状态 Rate Limiting binding 可以完成。

Cloudflare Workers Rate Limiting binding 适合用随机 session ID 作为 key；官方不建议把共享 IP 作为唯一用户标识，而且该计数是按 Cloudflare location、最终一致的，所以 IP 规则只作为更宽松的应急层，而不是精确配额。参见 [Cloudflare Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。

限速响应统一为：

```json
{
  "error": {
    "code": "relay_rate_limited",
    "message": "请求过于频繁，请稍后重试。",
    "retry_after_seconds": 60
  }
}
```

并设置真实的 `Retry-After`，前端队列不得无间隔重试。

## 10. 浏览器端设计

### 10.1 回退流程

1. 根据 Provider 配置和缓存确定传输模式。
2. `auto` 模式先对 `/models` 做无副作用探测；只有该探测的 `TypeError/Failed to fetch` 才触发 Relay 协商。
3. 探测拿到任意 HTTP Response 时选择 direct；上游返回 4xx/5xx 不切换路径。
4. 探测确认不可直连时，根据调用函数确定 operation，不能再从任意 URL 猜 method。
5. `ensureRelaySession()` 懒加载 Turnstile；同一时间所有调用共享一个 bootstrap Promise。
6. generation/edit 随后直接调用已选定的 direct 或 v2 通道，不做有副作用的试错重放。
7. 如果一个 generation/edit POST 已经发出后出现结果不明的网络错误，不自动改用另一个通道重放；标记为“请求结果未知”，由用户明确决定是否重试。
8. 401/403、429、413、502/504 和本地验证错误分别显示，不统一包装成 CORS 文案。

### 10.2 传输协商

静态 Web 在当前页面会话内按规范化 API Base 缓存 `direct | relay`；初始状态等价于 `auto`：

- Provider 新建、API Base 改变或缓存过期时，先请求 `/models`；只要浏览器拿到任意 HTTP `Response`（包括 401/404），就证明 CORS 通道可用，记为 `direct`。
- 若无副作用探测得到浏览器网络/CORS `TypeError`，建立 Relay 会话并通过 v2 再测试，成功后记为 `relay`。
- 探测结果按规范化 API Base 保存在内存；刷新页面或修改 API Base 后会重新检测，避免把过期网络判断长期写入用户配置。
- `auto` 不能对已经发出的 generation/edit POST 自动从 direct 切到 relay，也不能反向自动重放。
- 对支持幂等键的 Provider，可为每个逻辑任务生成稳定 request ID，并按 Provider capability 转发 `Idempotency-Key`；未知 Provider 不假设一定支持。

这一协商既减少不必要的 Relay 流量，也避免把“响应不可见”误判为“上游完全没有执行”。

### 10.3 用户体验

- 正常直连用户完全看不到验证流程。
- 第一次确实需要 Relay 时显示“正在建立安全中转连接”；Turnstile 使用 Managed + `interaction-only`，只有高风险访问才显示交互。
- 会话有效期内不重复验证。
- 明确提示 API Key 仅保存在当前浏览器并会经过用户选择的上游及本站 Relay 内存转发。
- 若 Turnstile 在特定网络不可达，提示切换桌面 App/Docker；不把安全控制失败伪装成 Provider 故障。
- 在中国大陆网络正式强制前，必须做真实网络可达性和交互成功率验证；不能只用海外 CI 冒烟测试代替。

### 10.4 CSP 配套

生产 Pages 增加 HTTP 响应头 CSP，并只为 Turnstile 精确开放 `challenges.cloudflare.com` 所需的 script/frame/connect；同时设置 `frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`Referrer-Policy` 和最小 `Permissions-Policy`。

不能为了接入 Turnstile 加入 `unsafe-eval` 或宽泛 `script-src *`。Turnstile 官方说明了其受控 hostname、sitekey/secret 和 CSP 依赖，参见 [Cloudflare Turnstile widgets](https://developers.cloudflare.com/turnstile/concepts/widget/)。

## 11. 日志、隐私与可观测性

### 11.1 允许记录

- 随机 request ID；
- operation；
- policy version；
- 上游 hostname 的带密钥 HMAC 截断值，或经过明确审批后的 hostname；
- 上游状态码、Relay 错误码；
- 请求/响应字节档位，不记录内容；
- 总耗时与上游耗时；
- 是否直连失败后回退、是否限流、是否触发重新验证。

### 11.2 永不记录

- `Authorization` 或 API Key 的 hash/prefix；
- Cookie、会话 token、Turnstile token；
- prompt、JSON body、multipart 内容、文件名；
- 完整 IP；
- 带 query 的 asset URL；
- Provider 响应正文。

当前分支只启用 Cloudflare Workers 的自动 invocation logs，不增加会记录业务字段的 `console.log`。后台用固定请求 path 和响应 status 区分 v1/v2 使用量；不查询或导出请求头、正文和上游目标。自动日志仍会采集请求 URL 等元数据，因此 v2 协议不能把签名 URL 或其他秘密放入 URL 或自定义请求头。后续如需长期聚合，再单独评审 Analytics Engine/OpenTelemetry 的字段和 retention。

### 11.3 告警

- 调用量、出站字节或 distinct session 相对 7 日基线突增；
- 429、策略拒绝、超限和异常比例持续升高；
- 单一会话访问大量不同 hostname；
- v1 端点仍有真实请求；
- Turnstile 验证失败或不可用率超过阈值；
- Worker 每日配额接近安全预算。

## 12. 配置与代码组织

### 12.1 Wrangler

已采用：

```jsonc
{
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "vars": {
    "RELAY_V2_ENABLED": "true",
    "RELAY_V1_MODE": "restricted",
    "RELAY_SESSION_TTL_SECONDS": "86400",
    "RELAY_ALLOWED_ORIGINS": "https://image.codex-pool.com",
  },
  "ratelimits": [
    {
      "name": "RELAY_SESSION_RATE",
      "namespace_id": "983746201",
      "simple": { "limit": 120, "period": 60 },
    },
    {
      "name": "RELAY_SESSION_ISSUE_RATE",
      "namespace_id": "983746202",
      "simple": { "limit": 10, "period": 60 },
    },
    {
      "name": "RELAY_LEGACY_RATE",
      "namespace_id": "983746203",
      "simple": { "limit": 80, "period": 60 },
    },
  ],
}
```

以下只允许通过 Cloudflare secret 管理，不写入仓库：

- `RELAY_SESSION_HMAC_KEY`
- `RELAY_SESSION_HMAC_KEY_PREVIOUS`（仅轮换窗口）
- `TURNSTILE_SITE_KEY`（公开值，但由部署环境注入，避免仓库内占位误上线）
- `TURNSTILE_SECRET_KEY`
- 可选的 hostname 日志 HMAC key

### 12.2 Worker 模块

当前实现拆成：

- `session.ts`：Siteverify、cookie、HMAC、过期与轮换；
- `policy.ts`：固定操作映射、API Base、asset URL、跳转、Origin 与内容类型策略；
- `streams.ts`：请求/响应流计数和 JSON 限长读取；
- `config.ts` / `types.ts`：环境配置、readiness 与公共类型；
- `index.ts`：路由和统一错误映射。

### 12.3 前端模块

- `relay-client.ts`：配置发现、Turnstile 懒加载、Promise 去重、传输协商和 operation-specific 请求构造；
- `openai.ts`：把已知操作交给安全传输层，并对错误中的签名 query 做脱敏；
- Provider 设置页：明确 Web Relay 的标准协议限制与桌面/Docker 兜底。

## 13. 迁移方案

不能直接把当前 `/api/relay` 切成强制 v2。生产流量低，迁移应同时以时间和真实请求数量作为判据。

### 阶段 0：只读基线

- 保留当前配置；
- 建立按 operation、状态、字节和来源类型的无敏感数据指标；
- 确认中国大陆与海外的真实访问路径；
- 记录 v1 所有标准/非标准路径，但不记录 API Key、正文或签名 query。

### 阶段 1：部署向后兼容的 Worker

- 新增 v2、session、限速和 kill switch；
- v1 暂时保留，但立即拒绝无 `Origin`、限制为标准四类操作并加宽松应急限速；
- v2 从第一天就强制会话和操作策略，但在新前端发布前只供 canary 使用；
- Worker 必须先于新前端部署。

### 阶段 2：部署新静态 Web

- 新前端开始使用 v2；
- v1 从新 Worker 上线起返回 `Deprecation: true`；只有在关闭日期经真实流量观察确认后才增加 `Sunset`，不能提前写一个无法兑现的日期；
- 旧缓存页面仍可通过受限 v1 工作；
- 观察至少 14 天，并且至少取得 20 次成功 v2 真实调用；如果请求不足 20 次，继续观察而不是按日历强切。

### 阶段 3：强制 v2

满足上线判据后：

- v2 强制会话、操作策略和限速；
- v1 仅对精确生产 Origin 保留短期兼容，返回明确升级错误；
- 再观察 14 天无合法 v1 请求后关闭 v1；
- 最终删除 `RELAY_MODE=open` 和 allowlist report-only 旧逻辑，避免误配置重新打开通用代理。

### 部署编排

Pages workflow 已把发布顺序固化为：

1. Worker test + typecheck + dry-run；
2. 进入 `cloudflare-production` Environment 审批，并检查 Worker secret 名称；
3. 部署向后兼容 Worker；
4. 轮询线上 v2 config，只有返回 `enabled=true` 才部署 Pages；
5. 执行真实浏览器 canary；
6. 不满足判据时停止，不自动把 Relay 切回 open。

## 14. 测试矩阵

### 14.1 URL/SSRF 单元测试

- HTTPS 正常域名、IDNA、合法 base path；
- `http:`、非 443 端口、userinfo、query、fragment；
- IPv4/IPv6 literal；十进制、八进制、十六进制和混合 IP；
- `localhost`、`.local`、`.internal`、`home.arpa`；
- 编码斜杠、反斜杠、dot segment、双重编码、控制字符；
- API 3xx 一律不跟随；asset 每一级跳转重新校验且最多两次；
- 任何路径构造都不能逃出固定 operation suffix。

### 14.2 会话与访问控制

- 缺少/伪造/过期/篡改 cookie；
- Turnstile token 缺失、过期、重复、hostname/action 不匹配；
- HMAC key 无中断轮换与旧 key 到期；
- 缺少 Origin、恶意 Origin、跨站 Fetch Metadata；
- 16/32 个并发前端调用只创建一次 session；
- 会话级 429 与 `Retry-After`；
- session endpoint 被刷时的 WAF/Worker 双层限制。

### 14.3 数据边界

- JSON、multipart 和 chunked 请求真实超限；
- 缺失/伪造 `Content-Length`；
- 上游超大/无限响应流；
- HTML 伪装 asset、错误 Content-Type；
- `Set-Cookie`、跳转和 hop-by-hop headers 不泄漏；
- asset 请求永不带 Authorization；
- 日志扫描确认没有 API Key、prompt、正文、cookie 和签名 query。

### 14.4 用户流程

- 任意支持 CORS 的新域名通过无副作用探测后仍可直接使用；
- 不支持 CORS 的标准 OpenAI-compatible 域名通过 v2 成功；
- `/models`、生成、编辑、多图批次、返回 base64、返回 URL 均成功；
- 上游 401/429/5xx 保持原意，不误触发另一条 Relay；
- direct generation/edit 在响应状态不明时不会自动通过 Relay 重放；
- Turnstile 不可达、session 过期、Worker kill switch 均有清楚提示；
- 桌面 App、Docker 和 CLI 不受影响。

## 15. 上线与回滚判据

### 15.1 上线必须满足

- Worker/前端全部单元和集成测试通过；
- 生产负向探针确认无 session、无 Origin、任意 path、私网目标和超限请求均被拒绝；
- 中国大陆与至少一个海外网络的浏览器 canary 通过；
- v2 成功率不低于同期 v1，策略误拒绝率低于 1%；
- Turnstile bootstrap 失败率低于 2%，大多数正常用户无交互完成；
- 至少 20 次真实 v2 成功调用覆盖 generations、edits 和 asset；
- 日志抽查无敏感内容；
- kill switch 和 secret 轮换演练通过。

### 15.2 回滚原则

- Worker v2 必须始终兼容旧前端，所以可以先回滚 Pages；
- 协议故障可把前端回滚到受限 v1，但不得恢复“无 Origin + 任意 URL”的 open 行为；
- Turnstile 故障可以临时切换为“受限操作 + 更严格会话/IP 限速”的降级模式，但必须有到期时间、告警和人工批准；不能永久 fail-open；
- 发生主动滥用时优先关闭公共 Relay，直连、桌面 App 和 Docker 仍可继续服务。

## 16. 残余风险与最终边界

即使采用 v2，能够通过 Turnstile 的攻击者仍可让自己控制的域名实现 `/images/generations`，因此公共匿名 Relay 不可能达到“只有好人能用”的绝对保证。v2 的价值在于：

- 请求不再是任意 method/path；
- 不能访问非公网目标或跟随未校验跳转；
- 不能无成本高速调用；
- 不能借 asset 通道携带用户 Authorization；
- 可以快速识别、限流和关闭异常会话；
- 正常用户仍可使用未知的新中转站域名。

如果未来流量或滥用规模超过这些控制能承受的范围，下一道边界只能是用户账号/组织登录，或停止为任意域名提供公共 Web Relay；不存在一个可以安全藏在前端里的万能密钥。
