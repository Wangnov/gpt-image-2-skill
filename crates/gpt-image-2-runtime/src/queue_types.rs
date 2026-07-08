use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
};

use gpt_image_2_core::{EditRequest, GenerateRequest};
use serde_json::Value;

pub struct JobQueueInner {
    pub max_parallel: usize,
    pub running: usize,
    pub queue: VecDeque<QueuedJob>,
    pub events: BTreeMap<String, Vec<Value>>,
    pub next_seq: BTreeMap<String, u64>,
}

impl Default for JobQueueInner {
    fn default() -> Self {
        Self {
            max_parallel: 2,
            running: 0,
            queue: VecDeque::new(),
            events: BTreeMap::new(),
            next_seq: BTreeMap::new(),
        }
    }
}

#[derive(Clone)]
pub enum QueuedTask {
    Generate(GenerateRequest),
    Edit(EditRequest),
}

#[derive(Clone)]
pub struct QueuedJob {
    pub id: String,
    pub command: String,
    pub provider: String,
    pub created_at: String,
    pub dir: PathBuf,
    pub metadata: Value,
    pub task: QueuedTask,
}
