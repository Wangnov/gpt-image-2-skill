use super::*;

#[test]
fn generation_slots_track_completed_failed_and_missing_outputs() {
    let slots = generation_slots_from_outputs(
        3,
        &[json!({"index": 0, "path": "/tmp/a.png", "bytes": 10})],
        &[json!({"index": 1, "message": "upstream rejected slot B"})],
        &[],
    );

    assert_eq!(slots[0]["status"], "completed");
    assert_eq!(slots[0]["path"], "/tmp/a.png");
    assert_eq!(slots[1]["status"], "failed");
    assert_eq!(slots[1]["error"], "upstream rejected slot B");
    assert_eq!(slots[2]["status"], "missing");

    let missing = missing_generation_slot_indices(&json!({
        "generation_slots": slots,
    }));
    assert_eq!(missing, vec![1, 2]);
}

#[test]
fn recovery_descriptor_offers_fill_missing_for_partial_outputs() {
    let slots = generation_slots_from_outputs(
        3,
        &[json!({"index": 0, "path": "/tmp/a.png", "bytes": 10})],
        &[json!({"index": 1, "message": "candidate B failed"})],
        &[],
    );
    let descriptor = build_recovery_descriptor(&json!({
        "id": "job-partial",
        "status": "partial_failed",
        "outputs": [{"index": 0, "path": "/tmp/a.png", "bytes": 10}],
        "metadata": {
            "n": 3,
            "recoverability": "recoverable.partial_outputs",
            "generation_slots": slots,
        },
    }));

    assert_eq!(descriptor["recoverability"], "recoverable.partial_outputs");
    assert_eq!(descriptor["primary_action"]["id"], "fill_missing");
    assert_eq!(descriptor["evidence"]["outputs_present"], 1);
    assert_eq!(descriptor["evidence"]["outputs_expected"], 3);
}

#[test]
fn recovery_descriptor_offers_reupload_for_completed_upload_failures() {
    let descriptor = build_recovery_descriptor(&json!({
        "id": "job-upload",
        "status": "completed",
        "storage_status": "failed",
        "outputs": [{"index": 0, "path": "/tmp/a.png", "bytes": 10}],
        "metadata": {
            "recoverability": "recoverable.local_response_cached",
        },
    }));

    assert_eq!(descriptor["recoverability"], "recoverable.upload_failed");
    assert_eq!(descriptor["primary_action"]["id"], "reupload");
    assert_eq!(descriptor["primary_action"]["billable"], false);
}

#[test]
fn history_job_events_persist_across_reads() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());

    upsert_history_job(
        "job-events-1",
        "images generate",
        "openai",
        "running",
        None,
        Some("2026-05-16T00:00:00Z"),
        json!({}),
    )
    .unwrap();
    append_history_job_event(
        "job-events-1",
        &json!({
            "seq": 1,
            "kind": "local",
            "type": "job.running",
            "data": {"status": "running"},
        }),
    )
    .unwrap();
    append_history_job_event(
        "job-events-1",
        &json!({
            "seq": 2,
            "kind": "local",
            "type": "job.completed",
            "data": {"status": "completed"},
        }),
    )
    .unwrap();

    let events = list_history_job_events("job-events-1").unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["type"], "job.running");
    assert_eq!(events[1]["data"]["status"], "completed");
}

#[test]
fn history_job_events_survive_status_updates() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());

    upsert_history_job(
        "job-events-update",
        "images generate",
        "openai",
        "queued",
        None,
        Some("2026-05-16T00:00:00Z"),
        json!({"prompt": "before"}),
    )
    .unwrap();
    append_history_job_event(
        "job-events-update",
        &json!({
            "seq": 1,
            "kind": "local",
            "type": "job.queued",
            "data": {"status": "queued"},
        }),
    )
    .unwrap();

    upsert_history_job(
        "job-events-update",
        "images generate",
        "openai",
        "failed",
        None,
        Some("2026-05-16T00:00:01Z"),
        json!({"prompt": "after"}),
    )
    .unwrap();

    let events = list_history_job_events("job-events-update").unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["type"], "job.queued");
}
