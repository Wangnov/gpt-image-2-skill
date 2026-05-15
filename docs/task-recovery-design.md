# 任务恢复协议（Task Recovery Protocol）

> Status: **Final V1** · 2026-05-15
> 经 [issues#14](https://github.com/Wangnov/gpt-image-2-skill/issues/14) 与 Codex 协同对齐，取代 V1/V2 草案。

## 1. 背景与命名

### 真实场景

> 用户在高铁上发起一个生成任务。OpenAI 已处理完请求并把响应送回，
> 但本地在接收/解析/落盘的某一步因弱网或进程切换失败。
> 结果：**OpenAI 已扣费、本地无可用产物**，UI 停在 `failed`，
> 用户能做的只有"重试"——而重试 = 再扣一次费。

### 为什么不叫"断点续传"或"重试"

OpenAI image API 当前实现使用非流式完整 JSON 调用（[openai.rs:36](crates/gpt-image-2-core/src/image_requests/openai.rs:36)），计费基于请求、无 idempotency-key、无结果回拉接口。**API 本身具备 streaming/event 能力，但当前未使用**；本协议在响应层增加 evidence capture，不改变 transport 形态。

"重试"作为命名是错的——它把"前端断了、后端在跑"、"响应在本地、写盘失败"、"图在本地、上传失败" 等**完全不同的恢复路径**合并成一个动作，而每条路径的计费后果天差地别。

正确命名是 **任务恢复（Task Recovery）**，包含五类**互不相同**的动作。下表 UI label 为最终用户面前的中文按钮文案（说明文风克制专业 + 按钮命名"完成/生成"，详见 §8）：

| 动作（UI label） | 内部 action id | 触发条件 | 计费 | V1 |
|---|---|---|---|---|
| **继续完成** | `continue_save` | 远端响应已到本地，本地落盘失败 | ❌ 不计费 | ✅ |
| **重新生成** | `resubmit` | 无法证明远端结果可恢复 | ✅ 全额，等同新请求 | ✅ |
| **生成缺失的 N 张** | `fill_missing` | 多图任务部分成功 | ⚠️ 仅缺失部分 | V2 |
| **重新上传** | `reupload` | 图已在本地，远端 Origin/Archive 上传失败 | ❌ 不计费 | V2 |
| 同步状态 | （走 GET /recovery 幂等读取） | 前端断了、后端仍在跑 | ❌ 不计费 | 无独立动作 |

绝不出现"重试"、"复活"、"抢救"、"挽回"这类词。

## 2. 设计原则

1. **任务是可审计事务**：每一阶段、每一次 attempt 的进入/退出/失败都有持久痕迹（在 metadata 内，不需要新表）。
2. **计费透明**：每一个会触发 API 调用的按钮都必须有"将再次调用 API"明示。
3. **后端推荐动作**：前端不做 `if failure_class == ... else ...` 派发；后端给一个 `RecoveryDescriptor`，前端只渲染。
4. **REST 纯洁性**：`GET /recovery` 幂等只读，所有 reconcile 入口共用；`POST /resume` 只做有副作用动作。
5. **单协议、双实施**：恢复协议放在 `gpt-image-2-core` 共享 crate，Tauri sidecar 与 `gpt-image-2-web` 都消费同一套定义。V1 不合并队列（`JobQueueInner`），只下沉业务层避免行为漂移。
6. **不破坏现有契约**：V1 不动 retry/timeout 默认值（`DEFAULT_REQUEST_TIMEOUT=300`、`DEFAULT_RETRY_COUNT=3`），不动 top-level job status 枚举，不建新表。
7. **不做无法兑现的承诺**：状态机里保留 `recoverable.remote_in_progress` 类别作为语义占位，但**V1 不会真正产生此状态**——它需要 provider 能力（远端状态查询/结果回拉）支持。

## 3. 场景全景与动作映射

| # | 场景 | recoverability | V1 主动作 |
|---|---|---|---|
| A | 请求未发出 | `recoverable.never_dispatched` | 重新生成 · 将再次调用 API |
| B | 请求 in-flight、连接断 | `ambiguous.remote_maybe_accepted` | 重新生成 · 将再次调用 API（含警告）|
| C | 响应 body 传输中断 | `ambiguous.remote_maybe_accepted` | 重新生成 · 将再次调用 API（含警告）|
| D | 响应已收到、本地落盘成功、后续失败 | `recoverable.local_response_cached` | **继续完成** |
| D' | 响应已收到、但 raw_response 未原子写入 | `terminal.local_recovery_unavailable` | 仅副按钮"重新生成 · 将再次调用 API"|
| E | n=4 任务收 2 张后失败 | `recoverable.partial_outputs` | (V2) 生成缺失的 N 张 |
| F | 进程被杀 | 启动扫描后归类到 A–E 之一 | 由扫描决定 |
| G | 前端断网、后端在跑 | `recoverable.remote_in_progress` | (语义保留，V1 不产生) |
| H | 图已存、上传失败 | `recoverable.upload_failed` | (V2) 重新上传 |
| I | provider 拒绝（4xx） | `terminal.provider_rejected` | 仅显示原因 |
| J | 用户取消 | `terminal.user_cancelled` | overflow 菜单"重新生成 · 将再次调用 API" |

**核心洞察**：场景 D 是最痛的、也是唯一一类我们能 100% 解决的。把它和场景 B/C 区分清楚是整个协议的价值所在。

## 4. 状态与恢复模型

### 4.1 Stage 枚举

精简到 6 阶段：

```
staged → submitted → response_received → materialized → uploaded → completed
```

任务在每次阶段转移时把 `stage` 字段写进 metadata。`failed_at_stage` = 出错时停留的 stage。

### 4.2 Recoverability 命名空间（终版）

```
recoverable.never_dispatched              请求未发出
recoverable.local_response_cached         响应完整收到且已 spool → 零 API 恢复
recoverable.partial_outputs               (V2) 多图部分成功
recoverable.upload_failed                 (V2) 图在本地、上传失败
recoverable.remote_in_progress            (V1 不产生；需 provider 能力支持)
ambiguous.remote_maybe_accepted           provider 是否扣费无法证明
terminal.local_recovery_unavailable       完整响应曾到达但未成功 spool（罕见边角）
terminal.provider_rejected                provider 4xx
terminal.user_cancelled                   用户主动取消
```

`recoverable.*` → 主按钮做对应动作；`ambiguous.*` → 主按钮"重新提交" + 显著扣费风险提示；`terminal.*` → 不显示恢复按钮，仅显示原因。

### 4.3 判定主规则（唯一权威）

```text
取 last_attempt = attempts[-1]

IF !last_attempt.request_started_at
  → recoverable.never_dispatched

IF last_attempt.response_body_completed_at != null
  AND last_attempt.raw_response_path != null
  → recoverable.local_response_cached

IF last_attempt.response_body_completed_at != null
  AND last_attempt.raw_response_path == null
  → terminal.local_recovery_unavailable
     (UI: "完整响应曾到达，但未成功保存恢复源")

IF provider 4xx
  → terminal.provider_rejected

IF user cancelled
  → terminal.user_cancelled

OTHERWISE (request_started but body not completed)
  → ambiguous.remote_maybe_accepted
```

**事实锚点**：以 `response_body_completed_at` + `raw_response_path` 两个字段是否非空为唯一判据。不以 stage 名作判据。

## 5. 数据模型

### 5.1 任务目录文件契约

| 文件 | 写入时机 | 关键契约 |
|---|---|---|
| `request_meta.json` | 阶段进入 `submitted` 之前 | atomic write |
| `raw_response.json` | 响应 body 完整接收后 | **`.part` → fsync → atomic rename**；rename 成功**才允许**写 `raw_response_path` 字段 |
| `partial/<index>.png` | (V2) 多图任务每张完成时 | atomic write |
| `error.json` | 失败时 | `failed_at_stage` · `error_chain` · `raw_provider_headers` (debug only) |

### 5.2 metadata JSON 扩展（V1 不动 schema）

`jobs.metadata` 内新增字段：

```jsonc
{
  // 现有字段不变
  "stage": "response_received",
  "recoverability": "recoverable.local_response_cached",
  "attempts": [
    {
      "attempt_id": "uuid",
      "client_request_id": "uuid",          // 本地生成；进 X-Client-Request-Id 头
      "provider_request_id": null,           // 归一化自 provider 响应 header（x-request-id / request-id 等）
      "request_started_at": "...",
      "response_headers_received_at": null,
      "response_body_completed_at": null,
      "raw_response_path": null,             // 仅 atomic rename 成功后填入
      "stage_at_failure": null,
      "error_code": null
    }
  ],
  "attempts_truncated_count": 0,             // 超过保留数后递增
  "interrupted_reason": null                 // 仅启动扫描产生的 interrupted
}
```

**护栏**：
- `attempts` 最多保留最近 **5 条**，旧的归并到 `attempts_truncated_count`
- `provider_request_id` 由 core 内 `normalize_provider_request_id(headers)` 归一化；原始 header 仅进 `error.json` 的 `raw_provider_headers` debug detail，不进 UI 主路径
- `estimated_cost_label` 由后端可选填入 RecoveryDescriptor，前端只渲染；**V1 不内置成本估算逻辑**

### 5.3 V2/V3 才评估的新表（V1 全部不建）

| 表 | V1 | 理由 |
|---|---|---|
| `job_events` 时间线 | ❌ V3 | metadata + error.json 已能覆盖 V1 用户故事 |
| `job_attempts` | ❌ V2 | V1 用 metadata 内 `attempts[]` 数组已足够 |
| `job_outputs` / 生成 slot 表 | ❌ V2 | V1 不做 `fill_missing`；V2 先用 metadata `generation_slots` 数组，复杂度真上来再升表 |

注意：**现有 [output_uploads](crates/gpt-image-2-core/src/history_db.rs:117) 表承载"上传"语义**（主键 `(job_id, output_index, target)`），**不能表达**"index 2 从未生成 / materialize 失败 / 已被用户接受为缺失"。V2 引入 `generation_slots` 时不要复用此表。

## 6. 后端架构

### 6.1 关键决定：协议下沉到 `gpt-image-2-core`

仓库存在两套并行的工作线程实现：

- [apps/gpt-image-2-app/src-tauri/src/queue_workers.rs](apps/gpt-image-2-app/src-tauri/src/queue_workers.rs)（400 行，Tauri 内嵌模式）
- [crates/gpt-image-2-web/src/queue_workers.rs](crates/gpt-image-2-web/src/queue_workers.rs)（539 行，Docker Web 模式）

各自的 `job_execution/` 子目录结构相似，但代码独立。
**任何恢复协议改动如果不下沉，工作量直接 ×2，且会出现两边行为漂移。**

V1 第 0 步：在 `gpt-image-2-core` 增加 `recovery` 模块，定义：

- `Stage` / `Recoverability` / `RecoveryAction` 枚举与决策函数
- `attempt metadata helpers`：stage timestamps · client_request_id · provider_request_id · raw_response_path
- `RawResponseSpooler` trait（`.part` → fsync → atomic rename 契约）
- `RecoveryDescriptor` 结构（API 返回值）
- `classify(stage, evidence, error) -> Recoverability` 纯函数
- `materialize_from_raw_response(job_dir) -> Result<Outputs>`（continue_save 的实现，**禁止调用 provider client**）
- `classify_zombie(job_dir, metadata) -> ZombieClass`（启动扫描复用）

**V1 不合并** `JobQueueInner`。两套 worker 虽重复，但还夹着 Tauri event emit / HTTP polling / notification dispatch / storage async 等差异，合并属于单独的 queue 重构。Tauri 与 web 各自的 worker 仅保留"调用上述 core 函数、把结果写进自己 SQLite"这一层薄壳。

### 6.2 HTTP 层

**V1 保持现有 transport policy 不变**：
- `DEFAULT_REQUEST_TIMEOUT = 300` ([constants.rs:29](crates/gpt-image-2-core/src/constants.rs:29))
- `DEFAULT_RETRY_COUNT = 3` ([constants.rs:25](crates/gpt-image-2-core/src/constants.rs:25))
- 现有指数退避保留

本协议**只在响应层增加 evidence capture**（headers_received_at / body_completed_at / raw_response_path），不改 transport policy。任何 retry/timeout 调整应单独评估。

### 6.3 工作线程改造（核心抢救）

修改 [streaming.rs](crates/gpt-image-2-web/src/job_execution/streaming.rs) +
[generate_runner.rs](crates/gpt-image-2-web/src/job_execution/generate_runner.rs)（两套都改）：

```
1. 创建 attempt，分配 client_request_id，写 request_meta.json
   stage = submitted
2. 调用 provider，attempt.request_started_at = now()
3. 收到 response headers → attempt.response_headers_received_at = now()
   归一化 provider_request_id 写入 attempt
4. body 完整接收 → attempt.response_body_completed_at = now()
5. ★ raw_response 原子落盘：
   write to raw_response.json.part → fsync → atomic rename
   仅在 rename 成功后写 attempt.raw_response_path
   stage = response_received
6. 解析、写图  (stage = materialized)
7. 上传到 storage  (stage = uploaded)
8. stage = completed
```

CLI 工具增 `--raw-response-out <path>` flag。

### 6.4 Recovery Service（V1 实现）

`gpt-image-2-core::recovery::`：

- `continue_save(job_id)` —— 调 `materialize_from_raw_response`，**禁止调用 provider client**。这是 V1 测试的必须断言项。UI label "继续完成"。
- `resubmit(job_id)` —— 创建新 job、复用参数（=现有 retry，保留为兼容）。UI label "重新生成 · 将再次调用 API"。
- `discard(job_id)` —— 显式归档失败任务。UI label "丢弃"。

V2 才加：`fill_missing` / `reupload`。**API action id 保持英文不变**（contract）；UI 文案见 §8。

### 6.5 启动扫描（Zombie reaper）

```rust
fn reap_on_startup(db, jobs_root) -> Vec<InterruptedJob> {
    for job in db.find_jobs_in_status(&[
        "staged", "submitted", "response_received", "materialized", "uploaded"
    ]) {
        let evidence = collect_evidence(job_dir(&job.id), &job.metadata);
        let recoverability = classify(job.stage, evidence, None);
        update_metadata(job, recoverability, interrupted_reason = "process_killed");
    }
}
```

启动后通过 `GET /jobs/interrupted` 暴露需用户决策的列表。

### 6.6 Provider 能力扩展

复用现有 [provider_capabilities.rs](apps/gpt-image-2-app/src-tauri/src/job_execution/provider_capabilities.rs)（已有 `supports_n`），扩展为：

```rust
struct ProviderCapabilities {
    supports_n: bool,
    supports_client_request_id: bool,        // 是否能带 X-Client-Request-Id
    supports_idempotency_key: bool,          // 真 idempotency-key；OpenAI image: false
    supports_remote_result_lookup: bool,     // 是否能用 remote id 回查结果
    supports_streaming_events: bool,         // 是否提供 event stream / partial events
    returns_ephemeral_urls: bool,            // 结果 URL 是否过期
}
```

**V1 仅后端使用**，不暴露给前端。前端只消费 `RecoveryDescriptor`。

## 7. API 设计

### 7.1 GET /jobs/{id}/recovery（幂等只读，所有 reconcile 入口）

```jsonc
{
  "job_id": "abc",
  "recoverability": "recoverable.local_response_cached",
  "primary_action": {
    "id": "continue_save",
    "label": "继续完成",
    "endpoint": "POST /jobs/abc/resume",
    "billable": false,
    "explanation": "上次接收到了模型响应，但保存到本地时失败。可在不重新调用 API 的前提下完成。"
  },
  "secondary_actions": [
    {
      "id": "resubmit",
      "label": "重新生成 · 将再次调用 API",
      "endpoint": "POST /jobs/abc/resume",
      "billable": true,
      "estimated_cost_label": null,
      "warning": "将再次调用 API"
    }
  ],
  "evidence": {
    "stage_reached": "response_received",
    "raw_response_present": true,
    "raw_response_bytes": 2418732,
    "outputs_present": 0,
    "outputs_expected": 4,
    "last_attempt": { /* attempts[-1] 摘要 */ }
  }
}
```

**Label 约定**：
- `billable: false` 的动作 → label 只写动词（"继续完成"），不加成本提示
- `billable: true` 的动作 → label 嵌入"· 将再次调用 API"，作为视觉上的一体化按钮文字

前端 reconnect、polling 恢复、打开 drawer 都调用此端点。

### 7.2 POST /jobs/{id}/resume（只做有副作用动作）

```jsonc
{ "action": "continue_save" }   // V1 支持: continue_save | resubmit | discard
```

**`continue_save` 实现契约**：只走 `materialize_from_raw_response`，不创建 provider client，不发出任何出站请求。

### 7.3 端点列表（V1 终版）

| Method | Path | 用途 |
|---|---|---|
| GET | `/jobs/interrupted` | 启动扫描发现的中断任务 |
| GET | `/jobs/{id}/recovery` | 推荐恢复动作 descriptor |
| POST | `/jobs/{id}/resume` | 执行恢复（按 action） |
| POST | `/jobs/{id}/retry` | 现有端点保留为 `resume?action=resubmit` 的别名，前端逐步迁移 |
| GET | `/jobs/{id}` | 扩展返回 `stage` / `recoverability` |

**不引入**：`sync_state` action、`/reconcile` 端点、`refresh_remote_status`（V1 不需要，未来 provider 能力出现再加）。

## 8. 前端 UI/UX

### 8.1 设计基调

- 不戏剧化（无"复活"等词）
- 以事实为先：先告知发生了什么，再告知能做什么
- 计费透明：触发 API 的按钮必须有"将再次调用 API"提示
- 危险操作收敛到 overflow 菜单
- 参考品味：Linear / Stripe / Vercel 的失败处理风格

### 8.2 文案混搭原则（用户拍板）

- **Chip / 说明文字 / toast / 抽屉解释**：方案 A 风格——事实先行、克制专业、不戏剧化（"上次接收到了模型响应，但保存到本地时失败"）
- **按钮命名**：方案 B 风格——动词为"完成 / 生成"而非"保存 / 提交"（"继续完成" / "重新生成"）
- **计费提示**：方案 A 嵌入式——`billable: true` 的按钮 label 内嵌"· 将再次调用 API"，让用户看一眼按钮就知道
- **Case 3（未发出）也加成本提示**：尽管上次未扣费，仍嵌入"· 将再次调用 API"，保持全局一致

### 8.3 历史列表 chip

| recoverability | chip 文字 | 颜色 |
|---|---|---|
| recoverable.never_dispatched | 待重新生成 | 中性灰 |
| recoverable.local_response_cached | 响应已收到，待继续完成 | 警告橙 |
| recoverable.partial_outputs *(V2)* | 2/4 已完成，可补齐 | 警告橙 |
| recoverable.upload_failed *(V2)* | 已生成，上传失败 | 警告橙 |
| ambiguous.remote_maybe_accepted | 状态未知，需确认 | 警告橙 |
| terminal.local_recovery_unavailable | 响应已丢失 | 中性灰 |
| terminal.provider_rejected | 已被拒绝 | 中性灰 |
| terminal.user_cancelled | 已取消 | 中性灰 |

### 8.4 卡片布局（高铁场景示例）

```
┌────────────────────────────────────────────────────┐
│ [缩略图占位 4×]                                     │
│                                                    │
│ "Yokohama at golden hour, 35mm film"               │
│ ───────────────────────────────────────────────    │
│ ⚠ 响应已收到，待继续完成 · 2 分钟前                  │
│ 上次接收到了模型响应，但保存到本地时失败。           │
│ 可在不重新调用 API 的前提下完成。                    │
│                                                    │
│ [继续完成]  [重新生成 · 将再次调用 API]      ⋯      │
└────────────────────────────────────────────────────┘
```

### 8.5 文案表（V1 终版）

| recoverability | 说明文字 | 主按钮 | 副按钮 | Overflow ⋯ |
|---|---|---|---|---|
| recoverable.never_dispatched | 请求未送达，可安全重新生成。上次未产生费用。 | 重新生成 · 将再次调用 API | — | 丢弃 |
| recoverable.local_response_cached | 上次接收到了模型响应，但保存到本地时失败。可在不重新调用 API 的前提下完成。 | **继续完成** | 重新生成 · 将再次调用 API | 查看详情 / 丢弃 |
| ambiguous.remote_maybe_accepted | 未收到完整响应。上次请求可能已被服务端接收。 | 重新生成 · 将再次调用 API | — | 查看详情 / 丢弃 |
| terminal.local_recovery_unavailable | 完整响应曾到达，但恢复源未保存成功。 | （无） | 重新生成 · 将再次调用 API | 查看详情 / 丢弃 |
| terminal.provider_rejected | {provider 返回的具体原因，例如：内容策略限制} | （无） | （无） | 查看详情 / 丢弃 |
| terminal.user_cancelled | 你在 {时间} 取消了这个任务。 | （无） | （无） | 重新生成 · 将再次调用 API / 丢弃 |

**实施约束**：
- `billable: false` 的 label = 纯动词，无后缀
- `billable: true` 的 label = `{动词} · 将再次调用 API`，作为一体化按钮文字渲染
- 后端如填 `estimated_cost_label`，前端拼接在 `· 将再次调用 API` 之后（如 `· 将再次调用 API · ~$0.04`）
- terminal.user_cancelled 故意把"重新生成"藏进 overflow，不主动推动用户重提

### 8.6 详情抽屉 timeline

点 ⋯ → "查看详情" 打开 side drawer：

```
任务时间线
─────────────────────────
✓ 已排队            03:11:58
✓ 已发送             03:12:00
✓ 远端已接收         03:12:11
✓ 已收到响应（4 张，2.4 MB）  03:12:38
✗ 保存失败：ENOSPC  03:12:42

可恢复性
─────────────────────────
响应已收到，待继续完成
上次接收到了模型响应，但保存到本地时失败。
点击「继续完成」可在不重新调用 API 的前提下完成。

请求摘要
  模型：gpt-image-2
  参数：n=4, size=1536x1024, quality=high

[继续完成]   [重新生成 · 将再次调用 API]   [复制错误信息]
```

### 8.7 启动后中断任务通知

- toast 而非 modal（modal 太重）
  > "上次有 3 个任务未正常完成。在历史中查看 →"
- 历史筛选器加默认过滤"需要处理"，徽章数 = N
- toast 关闭后本会话不再提示

### 8.8 历史列表筛选器

| 选项 | 文案 |
|---|---|
| 默认 quick filter | 需要处理（{N}）|
| 全部 | 全部 |
| 已完成 | 已完成 |
| 进行中 | 进行中 |
| 需要处理 | 需要处理 |
| 已取消 | 已取消 |

### 8.9 Docker Web 模式特殊提示

Docker Web 部署下前端通过 HTTP 跨网访问后端。前端 reconnect 时**始终先调 `GET /jobs/{id}/recovery`** 拉取最新 descriptor，而非假设旧前端状态有效。无需独立 reconcile 端点。

## 9. 落地切片

### V0 — 文案修正（半天，纯前端，独立 PR）

仅改前端 UI 上"会重新调用 provider、会创建新 job"动作的文案：
- 历史列表 / 详情面板上的"重试" → "重新生成 · 将再次调用 API"
- tooltip / aria 同步
- 本地保存失败 retry / 配置测试 retry 等**不改**

不动任何后端逻辑。立刻消除"重试 = 不会扣费"的误解。

### V1 — 核心可恢复

**后端（按顺序）**：
1. `gpt-image-2-core::recovery` 模块（含纯函数 + traits + 单元测试覆盖 classify / materialize）
2. CLI 增 `--raw-response-out`
3. 改造 `crates/gpt-image-2-web/src/queue_workers.rs`：响应到达即 atomic spool；调用 core 完成判定
4. mirror 到 `apps/.../src-tauri/src/queue_workers.rs`
5. 启动扫描 + zombie 归类（共享 core）
6. 新 API：`GET /recovery` / `POST /resume` / `GET /interrupted`；retry 端点保留为 `resume?action=resubmit` 别名
7. 集成测试：双 worker 真实 e2e mask 动态字段后**结构化等价**；core descriptor 用 fixture **字节级 golden**（参见 acceptance §3.3 Case 5）

**前端**：
1. 接 `/recovery` 端点
2. 历史卡片按 recoverability 渲染 chip + 主按钮
3. 详情 drawer：timeline + 可恢复性说明 + 操作按钮
4. 启动后中断任务 toast
5. 移除把所有失败混成"红色 ⊘"的旧渲染

### V2 — 补齐 + 补传

- 多图任务每张落 `partial/<index>.png`，metadata 加 `generation_slots[]`
- `POST /resume?action=fill_missing` / `reupload`
- 前端对应主按钮 + 错误详情面板增强
- 评估是否升级 `generation_slots` 为新表 `job_outputs`

### V3（延后）

- `job_events` 持久化时间线（替代 metadata 内的离散字段）
- 离线草稿排队
- Provider 能力表更细化 / 暴露给"切换 provider"页面

## 10. 测试计划

| 用例 | 模拟方法 | 期望 |
|---|---|---|
| D：响应已到、写盘失败 | `chmod -w job_dir` 后跑生成 | recoverability = `local_response_cached`，"继续保存" 可用 |
| **continue_save 零 API**（必须）| mock provider client 禁止任何出站请求 | 调用次数 = **0**，最终产物完整 |
| F：进程被杀 | `kill -9` 后重启 | `running` 任务被归类，不残留 |
| G：前端断网 reconnect | 前端 mock 断 fetch，后端继续跑 | 前端调 GET /recovery 拿到 `completed`，**无需 POST** |
| D'：原子写失败 | mock fsync 抛错 | recoverability = `terminal.local_recovery_unavailable`，UI 显示"完整响应曾到达，但未成功保存恢复源" |
| 双扣防护 | 连点"继续保存" 两次 | 第二次幂等（基于 attempts 计数）|
| ambiguous 警告 | mock submitted 阶段 reset by peer | recoverability = `ambiguous.remote_maybe_accepted`，主按钮"重新提交"显示风险提示 |
| **双 worker 行为一致** | 同组用例分别跑 Tauri 与 Docker Web | RecoveryDescriptor 字节级一致 |
| attempts 限长 | 强制连续 6 次 resubmit | `attempts.length == 5`，`attempts_truncated_count == 1` |

## 11. 开放问题（V2 及之后再定）

1. `ambiguous` 的精细化判定（V1 保守归一，V2 是否细分）
2. raw_response.json 清理策略（建议默认成功后保留 7 天 + 设置项可调）
3. `gpt-image-2-core` 抽取后是否继续合并 `JobQueueInner`（队列重构单独提案）
4. 云端同步场景下 raw_response 的处理（V1 明确不入云同步）
5. provider 能力表前端可见性（V2 起评估）

## 12. 关键代码触点速查

| 模块 | 文件 | V1 改动 |
|---|---|---|
| 状态枚举 | [types.ts:187](apps/gpt-image-2-app/src/lib/api/types.ts:187) | 扩展（加 `stage` / `recoverability`）|
| 历史 DB | [history_db.rs:50](crates/gpt-image-2-core/src/history_db.rs:50) | metadata JSON 加 attempts/stage/recoverability 字段，schema 不动 |
| 队列 worker（双套）| [src-tauri queue_workers.rs](apps/gpt-image-2-app/src-tauri/src/queue_workers.rs) · [web crate queue_workers.rs](crates/gpt-image-2-web/src/queue_workers.rs) | 改为薄壳，业务下沉到 core |
| 流式输出（双套）| `**/job_execution/streaming.rs` | 改造：响应 → raw_response atomic spool |
| 生成 runner（双套）| `**/job_execution/generate_runner.rs` | attempts 记录 + raw spool |
| Provider 能力 | [provider_capabilities.rs](apps/gpt-image-2-app/src-tauri/src/job_execution/provider_capabilities.rs) | 扩展 5 个能力字段（仅后端） |
| 重试 API | [retry_api.rs:149](crates/gpt-image-2-web/src/retry_api.rs:149) | 保留为 `resume?action=resubmit` 的实现 |
| 任务 hook | [use-jobs.ts:35](apps/gpt-image-2-app/src/hooks/use-jobs.ts:35) | 接 `/recovery` 端点 |
| 恢复模块 | (新) `crates/gpt-image-2-core/src/recovery/` | 新增 |
| 启动扫描 | (新) 在两套 worker 启动路径调用 core 函数 | 新增 |
