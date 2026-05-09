use std::collections::BTreeMap;

use crate::CredentialRef;

use super::types::NotificationConfig;

fn preserve_empty_file_credential(next: &mut CredentialRef, existing: Option<&CredentialRef>) {
    if let CredentialRef::File { value: next_value } = next
        && next_value.is_empty()
        && let Some(CredentialRef::File {
            value: existing_value,
        }) = existing
    {
        *next_value = existing_value.clone();
    }
}

pub fn preserve_notification_secrets(next: &mut NotificationConfig, existing: &NotificationConfig) {
    if let Some(next_password) = next.email.password.as_mut() {
        preserve_empty_file_credential(next_password, existing.email.password.as_ref());
    }

    let existing_webhooks = existing
        .webhooks
        .iter()
        .map(|webhook| (webhook.id.as_str(), webhook))
        .collect::<BTreeMap<_, _>>();
    for webhook in &mut next.webhooks {
        let existing_webhook = existing_webhooks.get(webhook.id.as_str()).copied();
        for (header, credential) in &mut webhook.headers {
            let existing_credential =
                existing_webhook.and_then(|webhook| webhook.headers.get(header));
            preserve_empty_file_credential(credential, existing_credential);
        }
    }
}
