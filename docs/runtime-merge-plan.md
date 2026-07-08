# PR9 — 下沉 web/tauri 孪生运行时代码到 `gpt-image-2-runtime`

状态：**进行中（地基已建，待完成两 crate 改接线 + 双 runtime 验证）**。

`crates/gpt-image-2-runtime/` 已从 workspace `members` 移到 `exclude`，所以主构建保持绿。完成后把它移回 `members`。

## 背景

`crates/gpt-image-2-web/src/job_execution/` 与 `apps/gpt-image-2-app/src-tauri/src/job_execution/`
（外加 `queue_workers.rs`、recovery/retry 的中间逻辑）是约 1200 行的孪生代码。
`generate_runner.rs` 两边逐字节相同、`edit_runner.rs` 仅差 `FsPath`/`Path` 别名。

## 唯一的 runtime-specific 接缝：`RuntimeHost`

编译后确认，共享的队列引擎除「事件发射」外还调用了随 `ProductRuntime` 变化的
`load_config` / `result_library_dir` / `dispatch_notifications_for_job`。因此正确抽象是一个
**5-seam 的 `RuntimeHost` trait**（不是最初以为的单一 `QueueEventSink`）：

```rust
pub trait RuntimeHost: Send + Sync + 'static {
    fn load_config(&self) -> Result<AppConfig, String>;
    fn result_library_dir(&self) -> PathBuf;
    fn dispatch_notifications(&self, job: &Value) -> Vec<Value>;
    fn emit_event(&self, job_id: &str, event: &Value);   // web: no-op；tauri: app.emit(...)
    fn job_id_prefix(&self) -> &'static str;              // "web" / "app"
}
```

用 `Arc<dyn RuntimeHost>`（动态分发）避免把泛型 ripple 到每个签名。队列引擎只持有
`inner: Arc<Mutex<JobQueueInner>>` + `host: Arc<dyn RuntimeHost>`（不是整个 `JobQueueState`），
所以 web 的 `JobQueueState.auth` 字段不必进共享层——web/tauri 各自保留自己的 `JobQueueState`
薄壳，调用共享函数时传入 `inner` 和 `host`。

**行为等价判据**：web 的 `NoopSink.emit` 为空，等价于当前 web「忽略 `append_queue_event`
返回值」；tauri 的 `AppHandleSink.emit` 等价于当前 `emit_queue_event(app, …)`。

## 已完成

- 新建 `crates/gpt-image-2-runtime`（Cargo.toml + lib.rs）。
- `lib.rs`：`RuntimeHost` trait、`JobQueueInner`/`QueuedTask`/`QueuedJob` 类型、
  `cli_json_result`/`error_value_from_message`/`error_message_from_value`/`app_error` helper。
- 已转换并编译干净：`streaming.rs`（`StreamContext` 改持 `inner + host`、输出回调 append 后
  `host.emit_event`）、`batch_payloads.rs`、`job_records.rs`、`queue_events.rs`、
  `provider_capabilities.rs`（采用 tauri 的可测 `*_from_config` 分解版，删掉调 load_config 的薄封装）、
  `generate_runner.rs`（加 `host` 参数、用 `provider_supports_n_from_config`）、
  `edit_runner.rs`（`FsPath`→`Path`、`config` 与 `host` 贯穿）。

## 待完成

1. **`queue_workers.rs`**（还剩约 16 个编译错误，全在这个文件）：把
   `append_terminal_queue_event` / `finish_queued_job` / `spawn_storage_upload_then_notify` /
   `spawn_notification_dispatch` / `start_queued_jobs` / `enqueue_job` 的 `state: JobQueueState`
   参数改成 `inner: Arc<Mutex<JobQueueInner>>` + `host: Arc<dyn RuntimeHost>`；
   `state.inner`→`inner`、`state.clone()`→分别 clone 两者；`load_config()`→`host.load_config()`；
   `dispatch_notifications_for_job(&job)`→`host.dispatch_notifications(&job)`；
   构造 `StreamContext` 用 `inner + host`；`run_generate_request`/`run_edit_request` 调用补 `host` 实参；
   补 `use std::{fs, thread, sync::{Arc, Mutex}}`。文件底部 web 独有的队列回归测试
   （约 190 行）改用一个 `TestRuntimeHost`（`load_config` 返回固定 config、`emit_event` 记录到
   `Vec` 便于断言）迁入共享 crate，保住覆盖。
2. **`job_paths.rs`**：`unique_job_dir` 用 `host.result_library_dir()` + `host.job_id_prefix()`。
3. **改接线 `gpt-image-2-web`**：实现 `struct WebHost`（`RuntimeHost`：`emit_event` 为
   no-op、`load_config`/`result_library_dir` 用 `ProductRuntime::DockerWeb`、`job_id_prefix`="web"）；
   删除 `src/job_execution/`、`src/queue_workers.rs`；`JobQueueState` 保留 `inner + auth`，
   handler 调共享函数时传 `state.inner.clone()` + `Arc::new(WebHost)`；
   `provider_supports_n`/`provider_edit_region_mode`/`selected_provider_name` 薄封装留在 web
   （用 web 的 `load_config` + 共享的 `*_from_config`）。
4. **改接线 tauri（`gpt-image-2-app`）**：实现 `struct AppHost { app: tauri::AppHandle }`
   （`emit_event` = `app.emit("gpt-image-2-job-event", …)`、config/paths 用 `ProductRuntime::Tauri`、
   `job_id_prefix`="app"）；删掉对应孪生文件；`DroppedImageFile`/`DroppedImageFiles` 留 tauri。
5. **入口 handler（D 类）不下沉**：web 的 axum async handler、tauri 的 `#[tauri::command]`
   各留各的，只把它们调用的共享中间逻辑（recovery 的 `continue_save_job`/`fill_missing_job`/
   `reupload_job`/`discard_job` 等）指向共享 crate。web 的 `run_core_blocking` 分流保留。
6. **验证**：
   - `cargo build --workspace` + `cargo test --workspace` 双绿。
   - web：`just dev-http-backend` + `just dev-http-frontend`，跑 generate / edit / 批量（n>1）/
     流式部分输出 / recovery。
   - **tauri（需人工）**：`just dev-tauri`，生成一张图看队列卡片实时更新（依赖 `AppHandleSink.emit`）、
     做一次编辑看流式部分输出——这是 headless 环境验证不了的决定性一步。
   - codex review 到无意见。

完整孪生差异映射见本次分析（A/B/C/D 分类）。
