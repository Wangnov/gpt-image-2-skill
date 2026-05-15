# 任务恢复协议 V1 验收方案

> Status: **Final v2** · 2026-05-16
> 配套 [docs/task-recovery-design.md](./task-recovery-design.md)
> 经 [issues#14](https://github.com/Wangnov/gpt-image-2-skill/issues/14) 完整对齐（含 Codex 三轮修正）

## 1. 验收原则

1. **三层 Tier 分工**：
   - **Tier 1** 自动化集成测试 — V1 PR merge gate（每次 PR 必跑）
   - **Tier 2** 真 DuckCoding + mitmproxy — release gate（发版前人工验收，**不卡 PR**）
   - **Tier 3** 人工生产观察 — 发版后由用户主导
2. **测试埋点用 cargo feature flag `recovery-fault-injection` 永久门控**，三层防泄漏
3. **`continue_save` resume 阶段 `provider_http_attempts` delta = 0** 是验收硬阈值
4. **稳定证明 `ambiguous` 用 deterministic local cutoff provider**，不依赖 mitm（mitm hook 时机不能精确切 wire-level body）
5. **核心 descriptor 用 fixture 字节级 golden + 真实 e2e 用结构化等价**（mask 动态字段后比较）
6. **门槛用 provider HTTP attempt 上限**，不写美元金额（价格/模型映射会变）

## 2. 测试埋点契约（V1 PR 必带）

### 2.1 cargo feature flag — core + app crate 双层

```toml
# crates/gpt-image-2-core/Cargo.toml
[features]
recovery-fault-injection = []

# crates/gpt-image-2-web/Cargo.toml & apps/.../src-tauri/Cargo.toml
[features]
recovery-fault-injection = ["gpt-image-2-core/recovery-fault-injection"]
```

`gpt-image-2-core` 提供故障注入 primitive；`gpt-image-2-web` / Tauri crate 在同名 feature 下注册 `/test/*` route 或 Tauri test command。core 不暴露 route helper trait（route 是 transport 层职责）。

### 2.2 三层防泄漏

```rust
// 编译期断言（防 release build 误启用）
#[cfg(all(feature = "recovery-fault-injection", not(any(test, debug_assertions))))]
compile_error!("recovery-fault-injection must not be enabled in release builds");
```

加上：
- 所有 `/test/*` route 与 fault registry 完全 `#[cfg(feature = "recovery-fault-injection")]` 门控
- CI smoke：release/default 构建的 binary `strings` 不应含 `RECOVERY_TEST_` 字面量
- 自带运行时验证 case：default feature 下设置 fault 应**无效**

### 2.3 故障注入点（最终命名）

V1 必测 6 个点；通过 feature-gated `POST /test/faults` 运行时注册（不用 env var 因为已运行进程无法热更新 env）：

```jsonc
POST /test/faults
{ "fail_at": "materialize_start" }   // 或 clear: { "fail_at": null }
```

V1 支持的 point：

| Point | 注入位置 | 期望恢复分类 |
|---|---|---|
| `raw_spool_rename` | body 已读完，`.part → rename` 前抛 IoError | `terminal.local_recovery_unavailable` |
| `materialize_start` | raw_response 已 rename，开始解析/写图前 | `recoverable.local_response_cached` |
| `metadata_after_spool` | raw_response 已 rename，但 metadata 写入失败 | 启动扫描必须靠**文件证据**恢复 → `recoverable.local_response_cached` |

```jsonc
POST /test/faults
{ "kill_at": "response_received" }
```

| Point | 注入位置 | 启动扫描期望分类 |
|---|---|---|
| `request_started` | 已开始 provider attempt，body 未完成时 `std::process::abort()` | `ambiguous.remote_maybe_accepted` |
| `raw_spool_renamed` | raw_response 已存在但 stage/metadata 未更新 | `recoverable.local_response_cached`（靠文件证据）|
| `response_received` | metadata 已写 response_received 后 abort | `recoverable.local_response_cached` |

V2 才加：`upload_start` / `materialized` / `uploaded` 等。

### 2.4 Provider HTTP attempt 计数器

**关键**：必须数实际 HTTP attempt，不是 logical provider call。当前 retry 在 [`execute_openai_with_retry`](crates/gpt-image-2-core/src/image_requests/retry.rs:5)，trait 层只包一层会漏掉内部 retry 的 `.send()`。

插桩位置：
- [`request_openai_images_once`](crates/gpt-image-2-core/src/image_requests/openai.rs:5) `.send()` 周围
- `request_openai_edit_once` 同
- `request_codex_*` 同

不假设 `ProviderClient` trait（**当前代码并不存在**）。

```rust
GET /test/jobs/{job_id}/provider-http-attempts
→ { "total": 1 }
```

**验收断言写法**（修正版）：

```text
before = provider_http_attempts(job_id)
POST /jobs/{id}/resume { "action": "continue_save" }
after  = provider_http_attempts(job_id)
assert after - before == 0
```

不能写 `count == 0`，因为初始真实 DuckCoding 调用必然 count=1。

### 2.5 完整 attempts 暴露 — 仅 feature-gated

**不污染生产 `GET /jobs/{id}` API**。raw_response_path / request id 类敏感字段走：

```
GET /test/jobs/{job_id}/attempts
→ { "attempts": [...], "attempts_truncated_count": 0 }
```

生产 `GET /jobs/{id}/recovery` 的 `evidence` 仅保留 `raw_response_present` / `raw_response_bytes` / `outputs_present` / `outputs_expected`。

### 2.6 raw_response hash — 仅 feature-gated

```
GET /test/jobs/{job_id}/raw-response-hash
→ { "sha256": "abc..." }
```

用于"continue_save 前后 raw_response 未被改动"断言。

## 3. Tier 1：自动化集成测试（V1 PR merge gate）

### 3.1 前置条件

- DuckCoding API key 由用户在 PR 验收时提供（仅 Case 1 真扣费）
- 其他 case 用 deterministic **local cutoff provider** 覆盖
- 启动后端时启用 feature `recovery-fault-injection`

### 3.2 Local cutoff provider

`scripts/local_cutoff_provider`（Rust binary 或 Python，`scripts/` 下）：用 `axum` / `hyper` 起 127.0.0.1 随机端口，实现 OpenAI 兼容 endpoint：

```
POST /v1/images/generations          标准生成入口（按当前模式响应）
POST /v1/images/edits                标准编辑入口（按当前模式响应）
POST /__test/cutoff                  test-only 控制端点，设置后续响应模式
```

cutoff 模式通过控制端点切换（**不放在 api_base query 里**——当前客户端会在 api_base 后追加 `/images/generations`，query 会被错误拼到中间）：

```jsonc
POST /__test/cutoff
{ "mode": "ok" }                                        // 正常完整响应
{ "mode": "body_after_n_bytes", "n": 512 }              // headers 后写 N byte 然后 close
{ "mode": "headers_only" }                              // headers 后立即 close
```

被测后端 / app 仅通过 **`ProviderConfig.api_base = http://127.0.0.1:<port>/v1`**（参见 [provider_types.rs:17](crates/gpt-image-2-core/src/provider_types.rs:17)）或 CLI `--openai-api-base http://127.0.0.1:<port>/v1`（[provider_selection.rs:186](crates/gpt-image-2-core/src/provider_selection.rs:186)）指向 cutoff provider。测试 setup 阶段写一个临时 provider 配置，不使用 `OPENAI_BASE_URL` env var（当前代码不识别此名称）。

测试用例 setup 流程：先 `POST /__test/cutoff` 设置模式，再发正常 `POST /v1/images/generations` 请求。

### 3.3 V1 PR merge gate — 9 个 Case

#### Case 1：场景 D + continue_save 零 API（**唯一真 DuckCoding case**）

1. POST `/test/faults` `{ "fail_at": "materialize_start" }`
2. POST `/api/images/generate` 真调 DuckCoding，`n=1`, prompt `"a small red cube on white background"`
3. 等待 job 终态
4. 断言：
   - `recoverability == recoverable.local_response_cached`
   - `<job_dir>/raw_response.json` 存在 & size > 0
5. 记录 `before = GET /test/jobs/{id}/provider-http-attempts`（应 = 1）
6. 记录 `hash_before = GET /test/jobs/{id}/raw-response-hash`
7. POST `/test/faults` `{ "fail_at": null }` 清除注入
8. POST `/jobs/{id}/resume` `{ "action": "continue_save" }`
9. **核心断言**：
   - `after - before == 0`
   - `status == completed`
   - `<job_dir>` 下完整 png 输出
   - `hash_after == hash_before`

#### Case 2：场景 D' terminal.local_recovery_unavailable（local cutoff）

1. setup：`POST cutoff_provider/__test/cutoff { "mode": "ok" }` + provider api_base 指向 cutoff provider
2. POST `/test/faults` `{ "fail_at": "raw_spool_rename" }`
3. POST 生成请求
4. 断言：
   - `recoverability == terminal.local_recovery_unavailable`
   - `attempts[-1].response_body_completed_at != null`
   - `attempts[-1].raw_response_path == null`
   - `GET /jobs/{id}/recovery` 的 `primary_action` 为 null
   - `secondary_actions` 含 `resubmit`，warning 含"完整响应曾到达，但恢复源未保存成功"

#### Case 3：场景 F kill after raw spool（local cutoff + abort）

1. setup：`POST cutoff_provider/__test/cutoff { "mode": "ok" }` + provider api_base 指向 cutoff provider
2. POST `/test/faults` `{ "kill_at": "raw_spool_renamed" }`
3. POST 生成请求 → 后端在 raw_response 已存在但 metadata 未更新时 abort
4. 重启后端
5. 启动扫描后断言：
   - `GET /jobs/interrupted` 包含此 job
   - `recoverability == recoverable.local_response_cached`（靠**文件证据**恢复）
   - `interrupted_reason == "process_killed"`
6. POST `/jobs/{id}/resume` `{ "action": "continue_save" }`
7. 断言 provider-http-attempts delta = 0、产物完整

#### Case 4：continue_save 幂等

1. 复用 Case 1 / Case 3 的失败任务
2. 第一次 resume 成功后再发一次 resume
3. 断言：
   - 第二次返回 200，状态等同第一次
   - provider-http-attempts delta = 0
   - attempts 数组不新增 entry

#### Case 5：双 worker 验证（分两个子 case）

**5a. core descriptor 字节级 golden**：
1. fixture：`tests/fixtures/recovery/local_response_cached/` 含 `metadata.json` + `raw_response.json` + `request_meta.json`
2. 调 core 函数 `recovery::build_descriptor(fixture_dir)` 输出 canonical JSON
3. 与 `tests/fixtures/recovery/local_response_cached/expected_descriptor.json` **字节级**比较

**5b. 真实 e2e 结构化等价**：
1. Tauri 模式跑 Case 1 步骤 → 保存 `GET /recovery` 响应 → `tauri.json`
2. Docker Web 模式跑相同步骤 → `web.json`
3. mask 字段（`job_id` / `client_request_id` / `provider_request_id` / `raw_response_bytes` / 所有 `*_at` 时间戳）后比较
4. 断言剩余字段（`recoverability` / `primary_action.id` / `secondary_actions[].id` / `billable` / `evidence.stage_reached` / `raw_response_present` / `outputs_expected`）完全相同

#### Case 6：attempts 限长

1. setup：`POST cutoff_provider/__test/cutoff { "mode": "ok" }` + provider api_base 指向 cutoff provider
2. POST `/test/faults` `{ "fail_at": "materialize_start" }`
3. 对同一 job 连续 6 次 `resume?action=resubmit`
4. 断言：
   - `attempts.length == 5`
   - `attempts_truncated_count == 1`
   - 最旧的 attempt 被丢弃，最新的保留

#### Case 7：conservative ambiguous（无效 base url）

1. 配置一个无效 `api_base`（如 `https://invalid-host-recovery-test.invalid/v1`）触发 DNS 失败
2. POST 生成请求
3. **严格断言** `recoverability == ambiguous.remote_maybe_accepted`
4. 不接受 `recoverable.never_dispatched`（V1 选择 conservative 路径，DNS 失败已进入 provider attempt 范畴）
5. `never_dispatched` 仅给参数校验、本地排队前失败等"明确未进入 provider attempt"场景

#### Case 8：local cutoff body 中断 → ambiguous

1. setup：`POST cutoff_provider/__test/cutoff { "mode": "body_after_n_bytes", "n": 512 }` + provider api_base 指向 cutoff provider
2. POST 生成请求
3. local cutoff server 返回 headers 后写 512 byte 然后 close socket
4. 断言：
   - `attempts[-1].response_headers_received_at != null`
   - `attempts[-1].response_body_completed_at == null`
   - `recoverability == ambiguous.remote_maybe_accepted`
   - `primary_action.id == "resubmit"`，`billable == true`，warning 含"上次请求可能已经被服务端接收"

#### Case 9：release build 防泄漏

1. `cargo build --release`（不带任何 feature）
2. 断言：
   - `strings target/release/<binary>` 不含 `RECOVERY_TEST_` 字面量
   - `curl http://localhost:8787/test/faults` → 404
   - 设置 `POST /test/faults` 的请求路径不存在
   - 即使尝试通过运行时手段触发 fault registry，行为应等同 default

### 3.4 总成本约束

不写美元阈值。约束改成：

> Tier 1 一轮完整执行：`sum(provider_http_attempts) <= 10`

其中只有 Case 1 真调 DuckCoding（最多 1 次 + 调试容忍 ≤ 5 次）。其余 case 全部走 local cutoff provider 不产生真实费用。

### 3.5 自动化脚本

`scripts/recovery-acceptance-tier1.sh`：

```bash
#!/bin/bash
# 启动 local cutoff provider
# 启动后端 with feature recovery-fault-injection
# 顺序跑 Case 1-9
# 输出 JSON 报告
```

输出格式：

```jsonc
{
  "started_at": "...",
  "tier": "tier1",
  "total_provider_http_attempts": 3,
  "duckcoding_calls": 1,
  "cases": [
    { "id": "case-1", "passed": true, "duration_ms": 12431, "provider_http_attempts_delta": 0 },
    // ...
  ],
  "overall": "PASSED"
}
```

## 4. Tier 2：mitmproxy 现实演练（release gate）

发版前人工跑，不卡每个 PR merge。

### 4.1 mitmproxy 仅作"现实网络演练"

不再用 `response()` hook 改 content-length —— hook 时机是 upstream 完整响应已收到后触发，改长度只能让客户端看到"完整但 JSON 损坏"，不能等价 wire-level body interrupted。

正确用法：streaming addon 拦 raw flow，在传输中途主动 reset 上下游连接。

### 4.2 准备

```bash
brew install mitmproxy
mitmproxy --listen-port 8080  # 启动一次生成 CA
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain \
  ~/.mitmproxy/mitmproxy-ca-cert.pem
export HTTPS_PROXY=http://127.0.0.1:8080
export SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem
```

发版后卸载证书：

```bash
sudo security delete-certificate -c mitmproxy /Library/Keychains/System.keychain
```

### 4.3 release gate case

**Case M1：真 DuckCoding + 中途 RST**
1. mitmproxy streaming addon 在 `api.duckcoding.com` 响应 body 的 N 个 byte 后强制 reset 双向连接
2. 真扣费 1 次
3. 期望 recoverability = `ambiguous.remote_maybe_accepted`
4. 这 case **作为发版前对真实 wire 行为的最终演练**，不作为 PR gate

### 4.4 release gate 通过标准

发版前手动跑 1 次 Case M1，记录截图 + RecoveryDescriptor JSON 入发版 release notes。

## 5. Tier 3：人工生产观察（发版后）

`scripts/inspect-job.sh <job_id>`：

```bash
#!/bin/bash
JOB_ID=$1
echo "=== Job state ==="
curl -s "http://localhost:8787/api/jobs/$JOB_ID" | jq '{stage, recoverability, status}'
echo "=== Recovery descriptor ==="
curl -s "http://localhost:8787/api/jobs/$JOB_ID/recovery" | jq
echo "=== Job dir ==="
ls -la "$HOME/.local/share/gpt-image-2/jobs/$JOB_ID" 2>/dev/null || \
  ls -la "$HOME/.codex/gpt-image-2-skill/jobs/$JOB_ID"
echo "=== raw_response present? ==="
test -f "$HOME/.local/share/gpt-image-2/jobs/$JOB_ID/raw_response.json" && \
  echo "yes ($(stat -f%z "$HOME/.local/share/gpt-image-2/jobs/$JOB_ID/raw_response.json") bytes)" || \
  echo "no"
```

用户在生产环境遇到失败任务时跑此脚本，输出贴回 issue 协助分析。

## 6. V1 PR merge gate 通过门槛

V1 PR 合并前必须满足：

- ✅ Tier 1 全 9 个 case 通过
- ✅ Case 1 在真实 DuckCoding 下通过（其他 case 走 local cutoff provider）
- ✅ Case 1 + Case 4：`continue_save` resume 阶段 `provider_http_attempts` delta = 0
- ✅ Case 5a：core descriptor 字节级匹配 fixture golden
- ✅ Case 5b：双 worker 真实 e2e 结构化等价
- ✅ Case 9：release/default 构建无 `/test/*` route，binary 无 `RECOVERY_TEST_` 字面量
- ✅ 一轮 `sum(provider_http_attempts) <= 10`

Tier 2 与 Tier 3 不作合并门槛。

## 7. 角色分工

| 步骤 | 谁做 |
|---|---|
| 实现 V1 + 测试埋点（feature-flagged）| V1 实现者 |
| 写 `scripts/local_cutoff_provider`（axum / hyper）| V1 实现者 |
| 写 `scripts/recovery-acceptance-tier1.sh` | V1 实现者 |
| 写 fixture `tests/fixtures/recovery/local_response_cached/` | V1 实现者 |
| 写 `scripts/inspect-job.sh` | V1 实现者 |
| 提供 `DUCKCODING_API_KEY`（仅 Case 1 用）| 用户 |
| 跑 Tier 1（V1 完成后）| Claude |
| 跑 Tier 2 release gate（V1 发版前）| Claude（用户授 mitm cert）|
| 生产 sanity check | 用户 + Claude 辅助分析 |
| V1 上线最终签字 | 用户 |

## 8. 配套生产配置（防泄漏强约束）

`recovery-fault-injection` feature **必须**在以下场景关闭：

- `cargo-dist` 发布的 release artifact
- `Tauri App Release` GitHub Actions workflow（参见 [docs/tauri-release.md](./tauri-release.md)）
- `Dockerfile` 构建（参见 [docs/docker-web.md](./docker-web.md)）
- 任何用户从源码编译的 default profile

CI 中应有一条 smoke test：

```bash
# 在 release pipeline 末尾
cargo build --release
strings target/release/gpt-image-2-web | grep -q RECOVERY_TEST_ && exit 1
strings target/release/gpt-image-2-web | grep -q '/test/faults' && exit 1
echo "✓ no recovery-fault-injection symbols leaked"
```

并加 `compile_error!` 兜底（参见 §2.2）。
