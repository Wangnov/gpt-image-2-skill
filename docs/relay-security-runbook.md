# Relay v2 安全上线手册

本文只适用于静态 Web 的 Cloudflare Worker 中转。CLI、桌面 App 和 Docker Web 不经过该 Worker。

## 上线前置条件

1. 在 Cloudflare Turnstile 创建 **Managed** widget，只绑定 `image.codex-pool.com`。Pages 预览域名没有同源 Worker route，只用于验证直连流程，不应跨域调用生产 Relay。
2. 先在中国大陆和海外各完成一次真实浏览器 canary。Turnstile 不可达时，支持 CORS 的服务仍会直连；只有依赖中转的用户会被阻止。
3. 在 Worker secret 中配置以下三项，值不得写入仓库、GitHub Actions 日志或聊天：
   - `TURNSTILE_SITE_KEY`
   - `TURNSTILE_SECRET_KEY`
   - `RELAY_SESSION_HMAC_KEY`：至少 32 字节随机值，建议 48 字节以上
4. GitHub 的 `CLOUDFLARE_API_TOKEN` 使用账号/区域受限的 API Token，不使用 Global API Key。最小部署权限包括 Account / Workers Scripts / Edit、Account / Cloudflare Pages / Edit，以及仅针对 `codex-pool.com` 的 Zone / Workers Routes / Edit；把 account 和 zone resource 收窄到本项目实际范围。权限依据见 [Workers CI](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 与 [Pages API](https://developers.cloudflare.com/pages/configuration/api/)。
5. 在 GitHub 为 `cloudflare-production` Environment 配置 required reviewer，并把 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` 收敛为该 Environment 的 secrets。Workflow 已绑定此 Environment；在 reviewer 和 canary 均未确认前不要批准部署 job。

交互式写入命令如下；每条命令会在终端中提示输入值：

```bash
cd workers/gpt-image-2-relay
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put RELAY_SESSION_HMAC_KEY
```

只检查名称、不显示 secret 值：

```bash
cd workers/gpt-image-2-relay
npx wrangler secret list --format json | jq 'map(.name)'
```

## 本地门禁

```bash
npm --prefix workers/gpt-image-2-relay audit --audit-level=high
npm --prefix apps/gpt-image-2-app audit --audit-level=high
just relay-test
just relay-dry
just app-test-browser
just app-build
test -f apps/gpt-image-2-app/dist/_headers
```

必须同时满足：

- Worker 测试、TypeScript 类型检查和 Wrangler dry-run 全部成功；
- 前端测试和构建成功；
- `dist/_headers` 存在 CSP；
- diff 中没有 API Key、Turnstile secret、cookie、签名 URL 或真实 prompt；
- 旧 `/api/relay` 仍通过受限兼容测试，且任意方法/路径被拒绝。

当前会话限速为 120 次/分钟，旧入口为 80 次/分钟，session 签发为 10 次/IP/分钟。前两项特意覆盖两个并行任务各拆分 16 次请求、随后各下载 16 张图片的合法峰值；不要在没有真实流量证据时调低。

`wrangler.jsonc` 中三个 `namespace_id` 必须在同一个 Cloudflare account 内保持唯一。正式部署前先核对现有 Worker 的 Rate Limiting bindings；若任一 ID 已被占用，换成该账号未使用的新整数 ID，并重新执行 Worker 测试和 dry-run。不要把三个 limiter 复用为同一个 namespace。

## 安全部署顺序

正式 Release 的 `.github/workflows/pages-deploy.yml` 已固定以下顺序：

1. 测试 Worker 与静态 Web；
2. 检查三个 Worker secret 的名称均存在；
3. 先部署 Worker；
4. 轮询 `https://image.codex-pool.com/api/relay/v2/config`；
5. 只有配置返回 `version=2`、`enabled=true`、`auth_mode=turnstile` 才部署 Pages。

这保证新网页不会先于新 Worker 上线。Worker 部署后即使 Pages 步骤失败，旧缓存页面仍走受限 v1；不会回退到开放代理。

Cloudflare Bot Fight Mode 可能在请求到达 Worker 前对 GitHub-hosted runner 返回 Managed Challenge。部署门禁只在响应明确包含 `cf-mitigated: challenge` 时允许替代验证：通过已认证的 Cloudflare API 确认最新 deployment 是本次 commit 标记的单一 100% Worker 版本，并逐项核对 restricted v1、v2、精确 Origin、Secure Cookie、3 个 Secret、3 个 rate-limit binding 与 `global_fetch_strictly_public`。普通 403、5xx、网络错误或任一绑定不符仍必须阻止 Pages 发布。

首次上线不要直接发正式 Pages。先单独部署 Worker并验证旧页面，再安排静态页面 canary：

```bash
just relay-deploy
curl --fail --silent https://image.codex-pool.com/api/relay/v2/config | jq
```

配置响应只能包含公开的 site key 和能力信息，不应包含任何 secret。

## 负向探针

以下探针不使用真实 API Key：

```bash
# v1 缺少 Origin，必须是 403
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST https://image.codex-pool.com/api/relay \
  --header 'X-GPT-Image-2-Upstream: https://example.com/v1/models' \
  --header 'X-GPT-Image-2-Method: GET'

# v2 缺少会话，必须是 401
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST https://image.codex-pool.com/api/relay/v2/models \
  --header 'Origin: https://image.codex-pool.com' \
  --header 'Sec-Fetch-Site: same-origin' \
  --header 'X-GPT-Image-2-Relay-Version: 2' \
  --header 'X-GPT-Image-2-Api-Base: https://example.com/v1' \
  --header 'Authorization: Bearer non-secret-probe'
```

真实浏览器 canary 还必须确认：

- 支持 CORS 的自定义域名只出现 `/models` 探测与直接生成请求，不出现 Turnstile；
- 不支持 CORS 的标准 OpenAI-compatible 域名显示 Turnstile，并经 v2 成功；
- 生成/编辑 POST 发生网络结果不明时，页面提示先去服务商后台确认，Network 面板中没有第二次 POST；
- 返回签名图片 URL 时，URL 只在 `/v2/asset` JSON body 内，不出现在自定义 header；
- 桌面 App、Docker 和 CLI 的请求路径完全不变。

## 后台用量观察

部署后在 Cloudflare Workers & Pages → `gpt-image-2-relay` → Observability → Query Builder 中，只按 `$workers.event.request.path` 与 `$workers.event.response.status` 分组计数。重点区分 `/api/relay`、`/api/relay/v2/session` 和四个 v2 operation；不要查询、复制或导出请求头、正文、Cookie、API Key、完整 IP、上游域名或签名 URL。Cloudflare 的 invocation logs 会自动包含请求/响应元数据，字段用法见 [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) 与 [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/)。

在 v1 观察期每天保存一次仅含日期、v1 总数、v2 总数、状态码分布的汇总。若账号日志 retention 短于 14 天，这份无敏感字段的日汇总就是关闭 v1 的连续性证据；不能只凭某一天“后台没看到请求”判断无人使用。

## 灰度与关闭 v1

新 Pages 上线后至少观察 14 天，并至少取得 20 次成功 v2 真实调用；流量不足 20 次时继续观察。期间保留 `RELAY_V1_MODE=restricted`。

同时满足以下条件后，才可把 `RELAY_V1_MODE` 改为 `disabled`：

- 连续 14 天没有确认属于合法旧页面的 v1 请求；
- 中国大陆与海外 Turnstile 成功率均可接受；
- 没有会话 401 循环、异常 429、重复生成或资源下载回归；
- 出站流量、失败率与 Cloudflare 费用没有异常。

## 回滚

- Worker canary 失败：不要发布 Pages，在 Cloudflare Workers 版本页恢复上一个已知正常版本；禁止把 `RELAY_MODE=open` 加回来。
- Pages 已发布但 v2 用户受影响：先恢复上一个 Pages deployment；受限 v1 在观察期内保持可用。
- 发现 SSRF、密钥泄漏或异常出站：立即将 `RELAY_ENABLED` 设为 `false` 并部署 Worker，随后轮换相关上游 API Key、Turnstile secret 和会话 HMAC key。
- HMAC 常规轮换：将旧值暂存为 `RELAY_SESSION_HMAC_KEY_PREVIOUS`，写入新 `RELAY_SESSION_HMAC_KEY`；等待最长会话 TTL（当前 24 小时）后删除 previous secret。

回滚完成的判据是线上行为验证，不是 workflow 变绿：至少重新检查 config、负向探针、一个直连 canary 和一个 relay canary。
