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
#[allow(deprecated)]
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
        // CloudPrimary mode is the only one whose Origin/Archives split keeps
        // emitting the wire token "fallback" for the archive uploads — we
        // need the historical "fallback_completed" status to survive when
        // the Origin upload fails and a downstream archive succeeds.
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("missing-primary".to_string()),
            archives: vec!["local-fallback".to_string()],
            cleanup: CleanupPolicy::default(),
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
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
#[allow(deprecated)]
fn mirror_pipeline_uploads_to_all_archives_in_parallel() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    fs::write(&output_path, b"png").unwrap();
    let archive_a = temp_dir.path().join("archive-a");
    let archive_b = temp_dir.path().join("archive-b");

    let config = StorageConfig {
        targets: BTreeMap::from([
            (
                "archive-a".to_string(),
                StorageTargetConfig::Local {
                    directory: archive_a.clone(),
                    public_base_url: None,
                },
            ),
            (
                "archive-b".to_string(),
                StorageTargetConfig::Local {
                    directory: archive_b.clone(),
                    public_base_url: None,
                },
            ),
        ]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::Mirror,
            origin: None,
            archives: vec!["archive-a".to_string(), "archive-b".to_string()],
            cleanup: CleanupPolicy::default(),
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let job = json!({
        "id": "job-mirror-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}],
    });
    upsert_history_job(
        "job-mirror-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-09T10:00:00Z"),
        json!({}),
    )
    .unwrap();

    let uploads =
        upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();

    assert_eq!(uploads.len(), 2);
    for upload in &uploads {
        assert_eq!(upload.status, "completed", "target {}", upload.target);
        assert_eq!(
            upload.metadata.get("role").and_then(|value| value.as_str()),
            Some("primary"),
            "mirror archives must surface as primary on the wire (target {})",
            upload.target
        );
    }
    // Both archives succeeded as primary -> overall status is "completed",
    // *not* "fallback_completed". Wire-format regression check (D1).
    assert_eq!(storage_status_for_uploads(&uploads), "completed");
    assert!(archive_a.join("job-mirror-1").join("1-out.png").is_file());
    assert!(archive_b.join("job-mirror-1").join("1-out.png").is_file());
}

#[test]
#[allow(deprecated)]
fn cloud_primary_origin_is_not_replayed_as_archive() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    fs::write(&output_path, b"png").unwrap();
    let origin_dir = temp_dir.path().join("origin");

    let config = StorageConfig {
        targets: BTreeMap::from([(
            "origin".to_string(),
            StorageTargetConfig::Local {
                directory: origin_dir.clone(),
                public_base_url: None,
            },
        )]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("origin".to_string()),
            archives: vec!["origin".to_string()],
            cleanup: CleanupPolicy::default(),
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let job = json!({
        "id": "job-cloud-primary-dedup-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}],
    });
    upsert_history_job(
        "job-cloud-primary-dedup-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-09T10:30:00Z"),
        json!({}),
    )
    .unwrap();

    let uploads =
        upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();

    assert_eq!(uploads.len(), 1);
    let upload = uploads.first().unwrap();
    assert_eq!(upload.target, "origin");
    assert_eq!(upload.status, "completed");
    assert_eq!(
        upload.metadata.get("role").and_then(|value| value.as_str()),
        Some("primary")
    );
    assert_eq!(storage_status_for_uploads(&uploads), "completed");
    assert!(
        origin_dir
            .join("job-cloud-primary-dedup-1")
            .join("1-out.png")
            .is_file()
    );
}

#[test]
#[allow(deprecated)]
fn per_job_overrides_are_appended_to_archives() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    fs::write(&output_path, b"png").unwrap();

    let dir_a = temp_dir.path().join("a");
    let dir_b = temp_dir.path().join("b");
    let dir_c = temp_dir.path().join("c");
    let config = StorageConfig {
        targets: BTreeMap::from([
            (
                "a".to_string(),
                StorageTargetConfig::Local {
                    directory: dir_a.clone(),
                    public_base_url: None,
                },
            ),
            (
                "b".to_string(),
                StorageTargetConfig::Local {
                    directory: dir_b.clone(),
                    public_base_url: None,
                },
            ),
            (
                "c".to_string(),
                StorageTargetConfig::Local {
                    directory: dir_c.clone(),
                    public_base_url: None,
                },
            ),
        ]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudArchiveOnly,
            origin: None,
            archives: vec!["c".to_string()],
            cleanup: CleanupPolicy::default(),
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 3,
        target_concurrency: 3,
        policy: StorageManagementPolicy::default(),
    };
    let job = json!({
        "id": "job-overrides-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}],
    });
    upsert_history_job(
        "job-overrides-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-09T11:00:00Z"),
        json!({}),
    )
    .unwrap();

    let overrides = StorageUploadOverrides {
        targets: Some(vec!["a".to_string()]),
        fallback_targets: Some(vec!["b".to_string()]),
    };
    let uploads = upload_job_outputs_to_storage(&config, &job, overrides).unwrap();

    let names = uploads
        .iter()
        .map(|upload| upload.target.clone())
        .collect::<Vec<_>>();
    assert!(names.contains(&"a".to_string()));
    assert!(names.contains(&"b".to_string()));
    assert!(names.contains(&"c".to_string()));
    assert_eq!(uploads.len(), 3);
    for upload in &uploads {
        assert_eq!(upload.status, "completed", "target {}", upload.target);
    }
}

#[test]
#[allow(deprecated)]
fn per_job_overrides_activate_default_local_only_pipeline() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    fs::write(&output_path, b"png").unwrap();

    let override_dir = temp_dir.path().join("override");
    let config = StorageConfig {
        targets: BTreeMap::from([(
            "override".to_string(),
            StorageTargetConfig::Local {
                directory: override_dir.clone(),
                public_base_url: None,
            },
        )]),
        ..StorageConfig::default()
    };
    let job = json!({
        "id": "job-override-local-only-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 3}],
    });
    upsert_history_job(
        "job-override-local-only-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-09T11:30:00Z"),
        json!({}),
    )
    .unwrap();

    let overrides = StorageUploadOverrides {
        targets: Some(vec!["override".to_string()]),
        fallback_targets: None,
    };
    let uploads = upload_job_outputs_to_storage(&config, &job, overrides).unwrap();

    assert_eq!(uploads.len(), 1);
    let upload = uploads.first().unwrap();
    assert_eq!(upload.target, "override");
    assert_eq!(upload.status, "completed");
    assert_eq!(
        upload.metadata.get("role").and_then(|value| value.as_str()),
        Some("primary")
    );
    assert!(
        override_dir
            .join("job-override-local-only-1")
            .join("1-out.png")
            .is_file()
    );
}

#[test]
#[allow(deprecated)]
fn cloud_primary_local_origin_readback_survives_missing_local_cache() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    let expected = b"png-local-readback";
    fs::write(&output_path, expected).unwrap();

    let origin_dir = temp_dir.path().join("origin");
    let config = StorageConfig {
        targets: BTreeMap::from([(
            "origin".to_string(),
            StorageTargetConfig::Local {
                directory: origin_dir.clone(),
                public_base_url: None,
            },
        )]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("origin".to_string()),
            archives: Vec::new(),
            cleanup: CleanupPolicy::default(),
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let job = json!({
        "id": "job-local-readback-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}],
    });
    upsert_history_job(
        "job-local-readback-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-12T15:00:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}]
            }
        }),
    )
    .unwrap();

    let uploads =
        upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();
    assert_eq!(uploads.len(), 1);
    assert_eq!(uploads[0].target, "origin");
    assert_eq!(
        uploads[0]
            .metadata
            .get("manifest")
            .and_then(|manifest| manifest.get("key"))
            .and_then(Value::as_str),
        Some("job-local-readback-1/1-out.png")
    );
    assert_eq!(
        uploads[0]
            .metadata
            .get("manifest")
            .and_then(|manifest| manifest.get("mime"))
            .and_then(Value::as_str),
        Some("image/png")
    );
    let head = crate::storage::backends::head_from_target(
        config.targets.get("origin").unwrap(),
        &uploads[0].metadata["manifest"],
    )
    .unwrap();
    assert_eq!(head.bytes, Some(expected.len() as u64));
    assert_eq!(
        head.metadata["path"],
        uploads[0].metadata["manifest"]["path"]
    );

    fs::remove_file(&output_path).unwrap();
    let readback = read_job_output_from_storage_with_options(
        &config,
        &job,
        0,
        StorageReadbackOptions {
            allow_archive_fallback: false,
            rehydrate_local_cache: true,
        },
    )
    .unwrap();
    assert_eq!(readback.bytes, expected);
    assert_eq!(readback.source["kind"], "origin");
    assert_eq!(readback.source["target"], "origin");
    assert!(output_path.is_file());
    assert_eq!(fs::read(&output_path).unwrap(), expected);
}

#[test]
#[allow(deprecated)]
fn cloud_primary_archive_readback_is_explicit_fallback() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    let expected = b"png-archive-readback";
    fs::write(&output_path, expected).unwrap();

    let origin_dir = temp_dir.path().join("origin");
    let archive_dir = temp_dir.path().join("archive");
    let config = StorageConfig {
        targets: BTreeMap::from([
            (
                "origin".to_string(),
                StorageTargetConfig::Local {
                    directory: origin_dir.clone(),
                    public_base_url: None,
                },
            ),
            (
                "archive".to_string(),
                StorageTargetConfig::Local {
                    directory: archive_dir.clone(),
                    public_base_url: None,
                },
            ),
        ]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("origin".to_string()),
            archives: vec!["archive".to_string()],
            cleanup: CleanupPolicy::default(),
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let job = json!({
        "id": "job-archive-readback-1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}],
    });
    upsert_history_job(
        "job-archive-readback-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-12T15:10:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}]
            }
        }),
    )
    .unwrap();
    upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();
    fs::remove_file(origin_dir.join("job-archive-readback-1/1-out.png")).unwrap();
    fs::remove_file(&output_path).unwrap();

    let origin_only = read_job_output_from_storage(&config, &job, 0).unwrap_err();
    assert_eq!(origin_only.code, "storage_readback_failed");

    let readback = read_job_output_from_storage_with_options(
        &config,
        &job,
        0,
        StorageReadbackOptions {
            allow_archive_fallback: true,
            rehydrate_local_cache: false,
        },
    )
    .unwrap();
    assert_eq!(readback.bytes, expected);
    assert_eq!(readback.source["kind"], "archive");
    assert_eq!(readback.source["target"], "archive");
}

#[test]
#[allow(deprecated)]
fn cloud_primary_after_archive_success_cleanup_deletes_local_cache() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    let expected = b"png-cleanup-readback";
    fs::write(&output_path, expected).unwrap();

    let config = StorageConfig {
        targets: BTreeMap::from([
            (
                "origin".to_string(),
                StorageTargetConfig::Local {
                    directory: temp_dir.path().join("origin"),
                    public_base_url: None,
                },
            ),
            (
                "archive".to_string(),
                StorageTargetConfig::Local {
                    directory: temp_dir.path().join("archive"),
                    public_base_url: None,
                },
            ),
        ]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("origin".to_string()),
            archives: vec!["archive".to_string()],
            cleanup: CleanupPolicy {
                mode: CleanupMode::AfterArchiveSuccess,
                retention_days: None,
                max_origin_gb: None,
            },
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let job = json!({
        "id": "job-cleanup-readback-1",
        "created_at": "1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}],
    });
    upsert_history_job(
        "job-cleanup-readback-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("1"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}]
            }
        }),
    )
    .unwrap();

    upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();
    assert!(!output_path.exists());

    let readback = read_job_output_from_storage_with_options(
        &config,
        &job,
        0,
        StorageReadbackOptions {
            allow_archive_fallback: true,
            rehydrate_local_cache: true,
        },
    )
    .unwrap();
    assert_eq!(readback.bytes, expected);
    assert!(output_path.is_file());
}

#[test]
#[allow(deprecated)]
fn cloud_primary_by_age_cleanup_parses_rfc3339_history_time() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let origin_dir = temp_dir.path().join("origin");
    let config = StorageConfig {
        targets: BTreeMap::from([(
            "origin".to_string(),
            StorageTargetConfig::Local {
                directory: origin_dir,
                public_base_url: None,
            },
        )]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("origin".to_string()),
            archives: Vec::new(),
            cleanup: CleanupPolicy {
                mode: CleanupMode::ByAge,
                retention_days: Some(1),
                max_origin_gb: None,
            },
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let output_path = temp_dir.path().join("source").join("out.png");
    fs::create_dir_all(output_path.parent().unwrap()).unwrap();
    fs::write(&output_path, b"png-age-cleanup").unwrap();
    let job = json!({
        "id": "job-age-cleanup-1",
        "created_at": "2020-01-01T00:00:00Z",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 15}],
    });
    upsert_history_job(
        "job-age-cleanup-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2020-01-01T00:00:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": 15}]
            }
        }),
    )
    .unwrap();

    upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();

    assert!(!output_path.exists());
}

#[test]
#[allow(deprecated)]
fn cloud_primary_by_size_cleanup_removes_oldest_protected_cache() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let origin_dir = temp_dir.path().join("origin");
    let config = StorageConfig {
        targets: BTreeMap::from([(
            "origin".to_string(),
            StorageTargetConfig::Local {
                directory: origin_dir,
                public_base_url: None,
            },
        )]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("origin".to_string()),
            archives: Vec::new(),
            cleanup: CleanupPolicy {
                mode: CleanupMode::BySize,
                retention_days: None,
                max_origin_gb: Some(0),
            },
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let output_path = temp_dir.path().join("source").join("out.png");
    fs::create_dir_all(output_path.parent().unwrap()).unwrap();
    fs::write(&output_path, b"png-size-cleanup").unwrap();
    let job = json!({
        "id": "job-size-cleanup-1",
        "created_at": "1",
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": 16}],
    });
    upsert_history_job(
        "job-size-cleanup-1",
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("1"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": 16}]
            }
        }),
    )
    .unwrap();

    upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();
    assert!(!output_path.exists());
}

#[test]
#[ignore = "requires live Cloudflare R2 credentials in GPT_IMAGE_2_R2_* env vars"]
#[allow(deprecated)]
fn cloud_primary_r2_origin_readback_survives_missing_local_cache() {
    let _guard = CODEX_HOME_TEST_LOCK.lock().unwrap();
    let temp_dir = tempfile::tempdir().unwrap();
    let _home = TestCodexHome::set(temp_dir.path());
    let source_dir = temp_dir.path().join("source");
    fs::create_dir_all(&source_dir).unwrap();
    let output_path = source_dir.join("out.png");
    let expected = b"png-r2-readback";
    fs::write(&output_path, expected).unwrap();

    let bucket = required_env("GPT_IMAGE_2_R2_BUCKET");
    let endpoint = required_env("GPT_IMAGE_2_R2_ENDPOINT");
    let region = std::env::var("GPT_IMAGE_2_R2_REGION").unwrap_or_else(|_| "auto".to_string());
    let job_id = format!("job-r2-readback-{}", std::process::id());
    let config = StorageConfig {
        targets: BTreeMap::from([(
            "r2-origin".to_string(),
            StorageTargetConfig::S3 {
                bucket,
                region: Some(region),
                endpoint: Some(endpoint),
                prefix: Some("readback-e2e".to_string()),
                access_key_id: Some(CredentialRef::Env {
                    env: "GPT_IMAGE_2_R2_ACCESS_KEY_ID".to_string(),
                }),
                secret_access_key: Some(CredentialRef::Env {
                    env: "GPT_IMAGE_2_R2_SECRET_ACCESS_KEY".to_string(),
                }),
                session_token: None,
                public_base_url: None,
            },
        )]),
        pipeline: Some(PipelineConfig {
            mode: PipelineMode::CloudPrimary,
            origin: Some("r2-origin".to_string()),
            archives: Vec::new(),
            cleanup: CleanupPolicy::default(),
        }),
        default_targets: Vec::new(),
        fallback_targets: Vec::new(),
        fallback_policy: StorageFallbackPolicy::OnFailure,
        upload_concurrency: 2,
        target_concurrency: 2,
        policy: StorageManagementPolicy::default(),
    };
    let job = json!({
        "id": job_id,
        "outputs": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}],
    });
    upsert_history_job(
        job.get("id").and_then(Value::as_str).unwrap(),
        "images generate",
        "openai",
        "completed",
        Some(&output_path),
        Some("2026-05-12T15:05:00Z"),
        json!({
            "output": {
                "files": [{"index": 0, "path": output_path.display().to_string(), "bytes": expected.len()}]
            }
        }),
    )
    .unwrap();

    let uploads =
        upload_job_outputs_to_storage(&config, &job, StorageUploadOverrides::default()).unwrap();
    assert_eq!(uploads.len(), 1);
    assert_eq!(uploads[0].target, "r2-origin");
    assert_eq!(uploads[0].status, "completed");
    let head = crate::storage::backends::head_from_target(
        config.targets.get("r2-origin").unwrap(),
        &uploads[0].metadata["manifest"],
    )
    .unwrap();
    assert_eq!(head.bytes, Some(expected.len() as u64));

    fs::remove_file(&output_path).unwrap();
    let readback = read_job_output_from_storage(&config, &job, 0).unwrap();
    assert_eq!(readback.bytes, expected);
    assert_eq!(readback.source["kind"], "origin");
    assert_eq!(readback.source["target"], "r2-origin");
}

fn required_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} must be set"))
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
