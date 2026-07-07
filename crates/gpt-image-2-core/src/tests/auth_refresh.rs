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

// When another actor (a sibling job, or the Codex CLI sharing auth.json) has
// already rotated the token, refresh_access_token must adopt the persisted
// credentials under its lock instead of spending our now-stale refresh_token
// on the network. Proven here by the absence of any network call: the default
// proxy would make a real REFRESH_ENDPOINT request, so a passing offline test
// means the short-circuit fired.
#[test]
fn refresh_adopts_persisted_token_without_network() {
    let dir = tempfile::tempdir().unwrap();
    let auth_path = dir.path().join("auth.json");
    // Disk already carries the freshly-rotated tokens.
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

    // Our in-memory state still holds the token that just 401'd.
    let mut state = auth_file_state(&auth_path, "OLD-access", "OLD-refresh");
    let payload = refresh_access_token(&mut state, &ProxyConfig::default()).unwrap();

    assert_eq!(payload["reused_persisted_refresh"], json!(true));
    assert_eq!(state.access_token, "NEW-access");
    assert_eq!(state.refresh_token.as_deref(), Some("NEW-refresh"));
    assert_eq!(state.account_id, "acct-2");
}

#[test]
fn save_auth_json_is_atomic_and_private() {
    let dir = tempfile::tempdir().unwrap();
    let auth_path = dir.path().join("nested").join("auth.json");
    let state = auth_file_state(&auth_path, "access-1", "refresh-1");

    save_auth_json(&state).unwrap();

    let written: Value = serde_json::from_str(&fs::read_to_string(&auth_path).unwrap()).unwrap();
    assert_eq!(written["tokens"]["access_token"], json!("access-1"));
    // The temp file used for the atomic rename must not linger.
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
