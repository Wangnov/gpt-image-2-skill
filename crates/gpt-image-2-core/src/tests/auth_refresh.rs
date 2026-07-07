use super::*;

fn auth_file_state(auth_path: &std::path::Path, access: &str, refresh: &str) -> CodexAuthState {
    CodexAuthState {
        auth_path: auth_path.to_path_buf(),
        auth_json: json!({
            "tokens": {
                "access_token": access,
                "refresh_token": refresh,
                "account_id": "acct-1",
            }
        }),
        access_token: access.to_string(),
        refresh_token: Some(refresh.to_string()),
        account_id: "acct-1".to_string(),
        persistence: CodexAuthPersistence::AuthFile,
    }
}

// The refresh path re-reads the persisted refresh_token under its lock so a
// second concurrent job refreshes with the freshest rotated token instead of
// re-spending the one the first job already consumed. This verifies the reload
// half of that: our in-memory copy is stale, disk holds the rotated token.
#[test]
fn reload_persisted_tokens_reads_the_rotated_refresh_token() {
    let dir = tempfile::tempdir().unwrap();
    let auth_path = dir.path().join("auth.json");
    fs::write(
        &auth_path,
        serde_json::to_string_pretty(&json!({
            "tokens": {
                "access_token": "NEW-access",
                "refresh_token": "NEW-refresh",
                "account_id": "acct-2",
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let state = auth_file_state(&auth_path, "OLD-access", "OLD-refresh");
    let (access, refresh, account) = reload_persisted_tokens(&state).unwrap();

    assert_eq!(access, "NEW-access");
    assert_eq!(refresh.as_deref(), Some("NEW-refresh"));
    assert_eq!(account.as_deref(), Some("acct-2"));
}

#[test]
fn reload_persisted_tokens_is_none_for_session_only() {
    let dir = tempfile::tempdir().unwrap();
    let mut state = auth_file_state(&dir.path().join("auth.json"), "a", "r");
    state.persistence = CodexAuthPersistence::SessionOnly;
    assert!(reload_persisted_tokens(&state).is_none());
}

#[test]
fn save_auth_json_is_atomic_and_private() {
    let dir = tempfile::tempdir().unwrap();
    let auth_path = dir.path().join("nested").join("auth.json");
    let state = auth_file_state(&auth_path, "access-1", "refresh-1");

    save_auth_json(&state).unwrap();

    let written: Value = serde_json::from_str(&fs::read_to_string(&auth_path).unwrap()).unwrap();
    assert_eq!(written["tokens"]["access_token"], json!("access-1"));
    // The unique temp file used for the atomic rename must not linger.
    let leftovers = fs::read_dir(auth_path.parent().unwrap())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != "auth.json")
        .count();
    assert_eq!(leftovers, 0, "atomic write left a temp file behind");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&auth_path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "auth.json must be private (0600)");
    }
}

// Concurrent writers must keep last-writer-wins without corrupting the file or
// leaving temp turds — each thread renames its own uniquely-named private temp.
#[test]
fn concurrent_atomic_writes_never_corrupt() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config-race.json");
    let threads = (0..8)
        .map(|i| {
            let path = path.clone();
            std::thread::spawn(move || {
                for round in 0..25 {
                    let body = serde_json::to_vec(&json!({"writer": i, "round": round})).unwrap();
                    atomic_write_private(&path, &body, "config_write_failed").unwrap();
                }
            })
        })
        .collect::<Vec<_>>();
    for thread in threads {
        thread.join().unwrap();
    }

    // Whatever won the last rename must be complete, valid JSON.
    let parsed: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert!(parsed.get("writer").is_some() && parsed.get("round").is_some());
    // No *.tmp survivors.
    let leftovers = fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name() != "config-race.json")
        .count();
    assert_eq!(leftovers, 0, "a concurrent writer left a temp file behind");
}
