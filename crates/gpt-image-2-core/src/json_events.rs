#![allow(unused_imports)]

use super::*;

pub struct JsonEventLogger {
    enabled: bool,
    pub(crate) seq: u64,
}

impl JsonEventLogger {
    pub fn new(enabled: bool) -> Self {
        Self { enabled, seq: 0 }
    }

    pub(crate) fn emit(&mut self, kind: &str, type_name: &str, data: Value) {
        if !self.enabled {
            return;
        }
        self.seq += 1;
        let record = json!({
            "seq": self.seq,
            "kind": kind,
            "type": type_name,
            "data": data,
        });
        eprintln!(
            "{}",
            serde_json::to_string(&record).unwrap_or_else(|_| {
                "{\"kind\":\"local\",\"type\":\"event_logger_failed\"}".to_string()
            })
        );
    }
}
