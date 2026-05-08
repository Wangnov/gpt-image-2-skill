#![allow(unused_imports)]

use super::*;

pub(crate) fn convert_provider_input(
    name: &str,
    input: ProviderInput,
    existing: Option<&ProviderConfig>,
) -> Result<(ProviderConfig, bool), String> {
    let mut credentials = BTreeMap::new();
    for (secret, credential) in input.credentials {
        let existing_credential = existing.and_then(|provider| provider.credentials.get(&secret));
        let converted = match credential {
            CredentialInput::File { value } => {
                let next = value.unwrap_or_default();
                if next.is_empty()
                    && let Some(CredentialRef::File { value }) = existing_credential
                {
                    CredentialRef::File {
                        value: value.clone(),
                    }
                } else {
                    CredentialRef::File { value: next }
                }
            }
            CredentialInput::Env { env } => CredentialRef::Env { env },
            CredentialInput::Keychain {
                service,
                account,
                value,
            } => {
                let service = service
                    .or_else(|| {
                        if let Some(CredentialRef::Keychain { service, .. }) = existing_credential {
                            service.clone()
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| KEYCHAIN_SERVICE.to_string());
                let account = account
                    .or_else(|| {
                        if let Some(CredentialRef::Keychain { account, .. }) = existing_credential {
                            Some(account.clone())
                        } else {
                            None
                        }
                    })
                    .unwrap_or_else(|| default_keychain_account(name, &secret));
                if let Some(value) = value
                    && !value.is_empty()
                {
                    write_keychain_secret(&service, &account, &value).map_err(app_error)?;
                }
                CredentialRef::Keychain {
                    service: Some(service),
                    account,
                }
            }
        };
        credentials.insert(secret, converted);
    }
    Ok((
        ProviderConfig {
            provider_type: input.provider_type,
            api_base: input.api_base,
            endpoint: input.endpoint,
            model: input.model,
            credentials,
            supports_n: input.supports_n,
            edit_region_mode: input.edit_region_mode,
        },
        input.set_default,
    ))
}
