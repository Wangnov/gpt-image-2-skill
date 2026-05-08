#![allow(unused_imports)]

use super::*;

pub fn default_keychain_account(provider: &str, secret: &str) -> String {
    format!("providers/{provider}/{secret}")
}

pub fn read_keychain_secret(service: &str, account: &str) -> Result<String, AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.get_password().map_err(|error| {
        AppError::new("keychain_missing", "Unable to read keychain secret.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })
}

pub fn write_keychain_secret(service: &str, account: &str, value: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.set_password(value).map_err(|error| {
        AppError::new("keychain_write_failed", "Unable to write keychain secret.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })
}

pub(crate) fn delete_keychain_secret(service: &str, account: &str) -> Result<(), AppError> {
    let entry = keyring::Entry::new(service, account).map_err(|error| {
        AppError::new("keychain_error", "Unable to open keychain entry.").with_detail(
            json!({"service": service, "account": account, "error": error.to_string()}),
        )
    })?;
    entry.delete_credential().map_err(|error| {
        AppError::new(
            "keychain_delete_failed",
            "Unable to delete keychain secret.",
        )
        .with_detail(json!({"service": service, "account": account, "error": error.to_string()}))
    })
}

pub(crate) fn resolve_credential(credential: &CredentialRef) -> Result<(String, String), AppError> {
    match credential {
        CredentialRef::File { value } => {
            if value.trim().is_empty() {
                Err(AppError::new(
                    "credential_missing",
                    "File credential is empty.",
                ))
            } else {
                Ok((value.clone(), "file".to_string()))
            }
        }
        CredentialRef::Env { env } => match std::env::var(env) {
            Ok(value) if !value.trim().is_empty() => Ok((value, format!("env:{env}"))),
            _ => Err(AppError::new(
                "credential_missing",
                format!("Missing environment credential: {env}"),
            )),
        },
        CredentialRef::Keychain { service, account } => {
            let service = service.as_deref().unwrap_or(KEYCHAIN_SERVICE);
            read_keychain_secret(service, account)
                .map(|value| (value, format!("keychain:{account}")))
        }
    }
}

pub(crate) fn get_provider_credential(
    provider_name: &str,
    provider: &ProviderConfig,
    key: &str,
) -> Result<(String, String), AppError> {
    provider
        .credentials
        .get(key)
        .ok_or_else(|| {
            AppError::new("credential_missing", format!("Missing credential: {key}"))
                .with_detail(json!({"provider": provider_name, "credential": key}))
        })
        .and_then(resolve_credential)
}
