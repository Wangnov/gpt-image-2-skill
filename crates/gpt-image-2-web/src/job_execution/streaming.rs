#![allow(unused_imports)]

use super::*;
pub(crate) use gpt_image_2_runtime::{
    BatchItemError, BatchRunResult, run_payloads_concurrently_streaming,
};

#[derive(Clone)]
pub(crate) struct StreamContext {
    pub(crate) inner: Arc<Mutex<JobQueueInner>>,
    pub(crate) job_id: String,
    pub(crate) command: String,
    pub(crate) provider: String,
    pub(crate) created_at: String,
    pub(crate) metadata: Value,
}

pub(crate) fn apply_partial_output(
    ctx: &StreamContext,
    partials: &mut Vec<Value>,
    batch_index: usize,
    payload: &Value,
) {
    let Ok(mut inner) = ctx.inner.lock() else {
        return;
    };
    let _ = gpt_image_2_runtime::apply_partial_output(
        &mut inner,
        gpt_image_2_runtime::PartialOutputContext {
            job_id: &ctx.job_id,
            command: &ctx.command,
            provider: &ctx.provider,
            created_at: &ctx.created_at,
            metadata: &ctx.metadata,
        },
        partials,
        batch_index,
        payload,
    );
}
