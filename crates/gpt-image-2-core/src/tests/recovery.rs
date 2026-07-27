use super::*;

#[test]
fn remote_async_task_is_classified_as_in_progress_without_cached_result() {
    let state = RecoveryState {
        remote_task: Some(RemoteImageTask {
            task_id: "task-1".to_string(),
            poll_url: "https://example.com/v1/images/tasks/task-1".to_string(),
            status: "processing".to_string(),
            submitted_at: "1".to_string(),
            updated_at: "1".to_string(),
        }),
        ..RecoveryState::default()
    };

    assert_eq!(
        classify_from_state_and_evidence(&state, false),
        Recoverability::RemoteInProgress
    );
}

#[test]
fn batch_remote_async_tasks_keep_parent_recovery_in_progress() {
    let state = RecoveryState {
        remote_tasks: vec![
            Some(RemoteImageTask {
                task_id: "task-complete".to_string(),
                poll_url: "https://example.com/v1/images/tasks/task-complete".to_string(),
                status: "completed".to_string(),
                submitted_at: "1".to_string(),
                updated_at: "2".to_string(),
            }),
            Some(RemoteImageTask {
                task_id: "task-running".to_string(),
                poll_url: "https://example.com/v1/images/tasks/task-running".to_string(),
                status: "processing".to_string(),
                submitted_at: "1".to_string(),
                updated_at: "2".to_string(),
            }),
        ],
        ..RecoveryState::default()
    };

    assert_eq!(
        classify_from_state_and_evidence(&state, false),
        Recoverability::RemoteInProgress
    );
}

#[test]
fn metadata_remote_tasks_survive_merge_without_a_parent_state_file() {
    let temp_dir = tempfile::tempdir().unwrap();
    let parent_dir = temp_dir.path().join("parent-without-state");
    let metadata = annotate_recovery_job_dir(
        json!({
            "recoverability": "recoverable.never_dispatched",
            "remote_tasks": [
                null,
                {
                    "task_id": "task-persisted",
                    "poll_url": "https://example.com/v1/images/tasks/task-persisted",
                    "status": "processing",
                    "submitted_at": "1",
                    "updated_at": "1"
                }
            ]
        }),
        &parent_dir,
    );

    let merged = merge_recovery_metadata(metadata, &parent_dir);

    assert_eq!(
        merged["recoverability"],
        Recoverability::RemoteInProgress.as_str()
    );
    assert_eq!(merged["remote_tasks"][1]["task_id"], "task-persisted");
}

#[test]
fn remote_async_recovery_offers_non_billable_resume_action() {
    for recoverability in [
        "recoverable.remote_in_progress",
        "terminal.local_recovery_unavailable",
    ] {
        let descriptor = build_recovery_descriptor(&json!({
            "id": "job-remote",
            "status": "failed",
            "metadata": {
                "recoverability": recoverability,
                "remote_task": {
                    "task_id": "task-remote",
                    "poll_url": "https://example.com/v1/images/tasks/task-remote",
                    "status": "processing",
                    "submitted_at": "1",
                    "updated_at": "1",
                },
            },
        }));

        assert_eq!(descriptor["primary_action"]["id"], "resume_remote");
        assert_eq!(descriptor["primary_action"]["billable"], false);
    }
}

#[test]
fn generic_missing_local_recovery_does_not_offer_remote_polling() {
    let descriptor = build_recovery_descriptor(&json!({
        "id": "job-no-remote",
        "status": "failed",
        "metadata": {
            "recoverability": "terminal.local_recovery_unavailable",
        },
    }));

    assert!(descriptor["primary_action"].is_null());
    assert_eq!(descriptor["secondary_actions"][0]["id"], "resubmit");
}

#[test]
fn concurrent_batch_remote_tasks_merge_without_losing_sibling_ids() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let parent_dir = temp_dir.path().join("job-batch-remote");
    upsert_history_job(
        "job-batch-remote",
        "images generate",
        "sub2api",
        "running",
        None,
        Some("2026-07-24T00:00:00Z"),
        annotate_recovery_job_dir(json!({"n": 2}), &parent_dir),
    )
    .unwrap();

    std::thread::scope(|scope| {
        for index in 0..2_u8 {
            let parent_dir = parent_dir.clone();
            scope.spawn(move || {
                let job_id = batch_recovery_job_id("job-batch-remote", index);
                let job_dir = batch_recovery_job_dir(&parent_dir, index);
                let mut recovery = RecoveryContext::new(job_id, job_dir).unwrap();
                recovery
                    .mark_remote_task(
                        &format!("task-{index}"),
                        &format!("https://example.com/v1/images/tasks/task-{index}"),
                        "processing",
                    )
                    .unwrap();
            });
        }
    });

    let job = show_history_job("job-batch-remote").unwrap();
    let tasks = job["metadata"]["remote_tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0]["task_id"], "task-0");
    assert_eq!(tasks[1]["task_id"], "task-1");
    assert_eq!(
        job["metadata"]["recoverability"],
        "recoverable.remote_in_progress"
    );
}

#[test]
fn stale_progress_snapshot_preserves_persisted_batch_remote_tasks() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let parent_dir = temp_dir.path().join("job-batch-progress");
    let stale_metadata = annotate_recovery_job_dir(json!({"n": 2}), &parent_dir);
    upsert_history_job(
        "job-batch-progress",
        "images generate",
        "sub2api",
        "running",
        None,
        Some("2026-07-24T00:00:00Z"),
        stale_metadata.clone(),
    )
    .unwrap();

    for index in 0..2_u8 {
        let job_id = batch_recovery_job_id("job-batch-progress", index);
        let job_dir = batch_recovery_job_dir(&parent_dir, index);
        let mut recovery = RecoveryContext::new(job_id, job_dir).unwrap();
        recovery
            .mark_remote_task(
                &format!("task-{index}"),
                &format!("https://example.com/v1/images/tasks/task-{index}"),
                "processing",
            )
            .unwrap();
    }

    // Streaming output snapshots are intentionally built from the queued
    // metadata, which predates async submission. This write must not erase the
    // accepted remote task IDs already merged into the parent history row.
    upsert_history_job(
        "job-batch-progress",
        "images generate",
        "sub2api",
        "running",
        Some(Path::new("/tmp/out-0.png")),
        Some("2026-07-24T00:00:00Z"),
        json!({
            "n": 2,
            "recovery_job_dir": parent_dir,
            "output": {
                "path": "/tmp/out-0.png",
                "files": [{"index": 0, "path": "/tmp/out-0.png"}],
            },
        }),
    )
    .unwrap();

    let job = show_history_job("job-batch-progress").unwrap();
    let tasks = job["metadata"]["remote_tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[0]["task_id"], "task-0");
    assert_eq!(tasks[1]["task_id"], "task-1");
    assert_eq!(
        job["metadata"]["recoverability"],
        "recoverable.remote_in_progress"
    );
    assert_eq!(job["metadata"]["output"]["files"][0]["index"], 0);
}

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
fn recovery_descriptor_keeps_fill_missing_when_partial_outputs_have_upload_failures() {
    let slots = generation_slots_from_outputs(
        3,
        &[json!({"index": 0, "path": "/tmp/a.png", "bytes": 10})],
        &[json!({"index": 1, "message": "candidate B failed"})],
        &[],
    );
    let descriptor = build_recovery_descriptor(&json!({
        "id": "job-partial-upload",
        "status": "partial_failed",
        "storage_status": "failed",
        "outputs": [{"index": 0, "path": "/tmp/a.png", "bytes": 10}],
        "metadata": {
            "n": 3,
            "recoverability": "recoverable.partial_outputs",
            "generation_slots": slots,
        },
    }));

    assert_eq!(descriptor["recoverability"], "recoverable.partial_outputs");
    assert_eq!(descriptor["primary_action"]["id"], "fill_missing");
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

#[test]
fn history_job_events_do_not_replace_on_duplicate_seq() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());

    upsert_history_job(
        "job-events-duplicate-seq",
        "images generate",
        "openai",
        "running",
        None,
        Some("2026-05-16T00:00:00Z"),
        json!({}),
    )
    .unwrap();
    let first_seq = append_history_job_event(
        "job-events-duplicate-seq",
        &json!({
            "seq": 1,
            "kind": "local",
            "type": "job.queued",
            "data": {"status": "queued"},
        }),
    )
    .unwrap();
    let second_seq = append_history_job_event(
        "job-events-duplicate-seq",
        &json!({
            "seq": 1,
            "kind": "local",
            "type": "job.running",
            "data": {"status": "running"},
        }),
    )
    .unwrap();
    assert_eq!(first_seq, 1);
    assert_eq!(second_seq, 2);

    let events = list_history_job_events("job-events-duplicate-seq").unwrap();
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["seq"], 1);
    assert_eq!(events[0]["type"], "job.queued");
    assert_eq!(events[1]["seq"], 2);
    assert_eq!(events[1]["type"], "job.running");
}
