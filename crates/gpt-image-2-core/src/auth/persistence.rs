#![allow(unused_imports)]

use super::*;

pub(crate) fn save_auth_json(auth_state: &CodexAuthState) -> Result<(), AppError> {
    match &auth_state.persistence {
        CodexAuthPersistence::AuthFile => {
            let mut content =
                serde_json::to_string_pretty(&auth_state.auth_json).map_err(|error| {
                    AppError::new("auth_write_failed", "Unable to serialize auth.json.")
                        .with_detail(json!({"error": error.to_string()}))
                })?;
            content.push('\n');
            fs::create_dir_all(
                auth_state
                    .auth_path
                    .parent()
                    .unwrap_or_else(|| Path::new(".")),
            )
            .map_err(|error| {
                AppError::new("auth_write_failed", "Unable to create auth directory.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            fs::write(&auth_state.auth_path, content).map_err(|error| {
                AppError::new("auth_write_failed", "Unable to save auth.json.")
                    .with_detail(json!({"error": error.to_string()}))
            })?;
            Ok(())
        }
        CodexAuthPersistence::ConfigProvider {
            config_path,
            provider_name,
            credential_sources,
        } => save_codex_config_credentials(
            config_path,
            provider_name,
            credential_sources,
            &auth_state.access_token,
            auth_state.refresh_token.as_deref(),
            &auth_state.account_id,
        ),
        CodexAuthPersistence::SessionOnly => Ok(()),
    }
}

pub(crate) fn save_codex_config_credentials(
    config_path: &Path,
    provider_name: &str,
    credential_sources: &BTreeMap<String, CredentialRef>,
    access_token: &str,
    refresh_token: Option<&str>,
    account_id: &str,
) -> Result<(), AppError> {
    let mut config = load_app_config(config_path)?;
    let provider = config.providers.get_mut(provider_name).ok_or_else(|| {
        AppError::new(
            "provider_unknown",
            format!("Unknown provider: {provider_name}"),
        )
    })?;
    persist_credential_value(provider, credential_sources, "access_token", access_token)?;
    persist_credential_value(provider, credential_sources, "account_id", account_id)?;
    if let Some(refresh_token) = refresh_token {
        persist_credential_value(provider, credential_sources, "refresh_token", refresh_token)?;
    }
    save_app_config(config_path, &config)
}

pub(crate) fn persist_credential_value(
    provider: &mut ProviderConfig,
    credential_sources: &BTreeMap<String, CredentialRef>,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    match credential_sources.get(key) {
        Some(CredentialRef::File { .. }) | None => {
            provider.credentials.insert(
                key.to_string(),
                CredentialRef::File {
                    value: value.to_string(),
                },
            );
            Ok(())
        }
        Some(CredentialRef::Keychain { service, account }) => write_keychain_secret(
            service.as_deref().unwrap_or(KEYCHAIN_SERVICE),
            account,
            value,
        ),
        Some(CredentialRef::Env { .. }) => Ok(()),
    }
}
