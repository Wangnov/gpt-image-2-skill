use super::*;

#[test]
fn history_upload_records_enrich_history_job_outputs() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());

    upsert_history_job(
        "job-storage-1",
        "images generate",
        "openai",
        "completed",
        None,
        Some("2026-05-08T10:00:00Z"),
        json!({
            "output": {
                "files": [
                    {"index": 0, "path": "/tmp/out-0.png", "bytes": 10},
                    {"index": 1, "path": "/tmp/out-1.png", "bytes": 12}
                ]
            }
        }),
    )
    .unwrap();

    upsert_output_upload_record(&OutputUploadRecord {
        job_id: "job-storage-1".to_string(),
        output_index: 0,
        target: "s3-main".to_string(),
        target_type: "s3".to_string(),
        status: "completed".to_string(),
        url: Some("https://cdn.example.com/out-0.png".to_string()),
        error: None,
        bytes: Some(10),
        attempts: 1,
        updated_at: "2026-05-08T10:01:00Z".to_string(),
        metadata: json!({"etag": "abc"}),
    })
    .unwrap();
    upsert_output_upload_record(&OutputUploadRecord {
        job_id: "job-storage-1".to_string(),
        output_index: 1,
        target: "s3-main".to_string(),
        target_type: "s3".to_string(),
        status: "failed".to_string(),
        url: None,
        error: Some("boom".to_string()),
        bytes: None,
        attempts: 2,
        updated_at: "2026-05-08T10:02:00Z".to_string(),
        metadata: Value::Null,
    })
    .unwrap();

    let uploads = list_output_upload_records("job-storage-1").unwrap();
    assert_eq!(uploads.len(), 2);

    let job = show_history_job("job-storage-1").unwrap();
    assert_eq!(job["storage_status"], "partial_failed");
    assert_eq!(job["outputs"][0]["uploads"][0]["target"], "s3-main");
    assert_eq!(
        job["outputs"][0]["uploads"][0]["url"],
        "https://cdn.example.com/out-0.png"
    );
    assert_eq!(job["outputs"][1]["uploads"][0]["status"], "failed");
    assert_eq!(job["outputs"][1]["uploads"][0]["error"], "boom");
}

#[test]
fn history_rows_without_upload_records_keep_legacy_outputs() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());

    upsert_history_job(
        "job-legacy-1",
        "images generate",
        "openai",
        "completed",
        None,
        Some("2026-05-08T11:00:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": "/tmp/legacy.png", "bytes": 99}]
            }
        }),
    )
    .unwrap();

    let job = show_history_job("job-legacy-1").unwrap();

    assert_eq!(job["outputs"][0]["path"], "/tmp/legacy.png");
    assert_eq!(job["outputs"][0].get("uploads"), None);
    assert_eq!(job["storage_status"], "not_configured");
}

#[test]
fn storage_upload_falls_back_to_local_target_after_primary_failure() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    fs::write(&output_path, b"png").unwrap();
    let fallback_dir = temp_dir.path().join("fallback");
    let config = StorageConfig {
        targets: BTreeMap::from([
            (
                "missing-primary".to_string(),
                StorageTargetConfig::Local {
                    directory: temp_dir.path().join("missing-parent").join("missing-file"),
                    public_base_url: Some("https://primary.example.com".to_string()),
                },
            ),
            (
                "local-fallback".to_string(),
                StorageTargetConfig::Local {
                    directory: fallback_dir.clone(),
                    public_base_url: Some("https://fallback.example.com/images".to_string()),
                },
            ),
        ]),
        default_targets: vec!["missing-primary".to_string()],
        fallback_targets: vec!["local-fallback".to_string()],
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
    };
    let job = json!({
        "id": "job-fallback-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}],
    });
    upsert_history_job(
        "job-fallback-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-08T12:00:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}]
            }
        }),
    )
    .unwrap();

    fs::write(
        temp_dir.path().join("missing-parent").join("missing-file"),
        b"not-a-dir",
    )
    .unwrap_err();
    fs::create_dir_all(temp_dir.path().join("missing-parent")).unwrap();
    fs::write(
        temp_dir.path().join("missing-parent").join("missing-file"),
        b"x",
    )
    .unwrap();

    let uploads =
        upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();

    assert_eq!(uploads.len(), 2);
    assert!(
        uploads
            .iter()
            .any(|upload| { upload.target == "missing-primary" && upload.status == "failed" })
    );
    let fallback = uploads
        .iter()
        .find(|upload| upload.target == "local-fallback")
        .unwrap();
    assert_eq!(fallback.status, "completed");
    assert_eq!(
        fallback.url.as_deref(),
        Some("https://fallback.example.com/images/job-fallback-1/1-out.png")
    );
    assert!(
        fallback_dir
            .join("job-fallback-1")
            .join("1-out.png")
            .is_file()
    );
    assert_eq!(storage_status_for_uploads(&uploads), "fallback_completed");
}

#[test]
fn s3_endpoint_builder_supports_aws_and_compatible_styles() {
    let (url, host, canonical_uri) =
        s3_endpoint_and_host("images", Some("us-west-2"), None, "jobs/1 out.png").unwrap();
    assert_eq!(
        url,
        "https://images.s3.us-west-2.amazonaws.com/jobs/1%20out.png"
    );
    assert_eq!(host, "images.s3.us-west-2.amazonaws.com");
    assert_eq!(canonical_uri, "/jobs/1%20out.png");

    let (url, host, canonical_uri) = s3_endpoint_and_host(
        "images",
        Some("us-east-1"),
        Some("https://s3.example.com"),
        "jobs/out.png",
    )
    .unwrap();
    assert_eq!(url, "https://s3.example.com/images/jobs/out.png");
    assert_eq!(host, "s3.example.com");
    assert_eq!(canonical_uri, "/images/jobs/out.png");

    let (url, host, _) = s3_endpoint_and_host(
        "images",
        Some("us-east-1"),
        Some("https://{bucket}.storage.example.com"),
        "jobs/out.png",
    )
    .unwrap();
    assert_eq!(url, "https://images.storage.example.com/jobs/out.png");
    assert_eq!(host, "images.storage.example.com");
}
