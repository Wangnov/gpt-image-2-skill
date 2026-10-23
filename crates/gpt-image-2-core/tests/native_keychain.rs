#![cfg(any(target_os = "macos", target_os = "windows"))]

use std::time::{SystemTime, UNIX_EPOCH};

// Opt-in only: use a unique, synthetic credential and remove it on every path.
// Never enumerate or read existing provider/account credentials.
#[test]
#[ignore = "requires an unlocked native credential store; explicitly run in native CI"]
fn native_v3_credentials_interoperate_with_v4() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let service = format!(
        "gpt-image-2-skill.native-test.{}.{nonce}",
        std::process::id()
    );
    let account = "synthetic-upgrade-test";
    let legacy = keyring_legacy::Entry::new(&service, account).unwrap();
    let modern = keyring::Entry::new(&service, account).unwrap();
    struct Cleanup(keyring::Entry);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = self.0.delete_credential();
        }
    }
    let _cleanup = Cleanup(modern);

    legacy.set_password("synthetic-v3-value").unwrap();
    assert_eq!(
        gpt_image_2_core::read_keychain_secret(&service, account).unwrap(),
        "synthetic-v3-value"
    );
    gpt_image_2_core::write_keychain_secret(&service, account, "synthetic-v4-value").unwrap();
    assert_eq!(legacy.get_password().unwrap(), "synthetic-v4-value");
    let reopened = keyring::Entry::new(&service, account).unwrap();
    assert_eq!(reopened.get_password().unwrap(), "synthetic-v4-value");
    reopened.delete_credential().unwrap();
    assert!(matches!(
        legacy.get_password(),
        Err(keyring_legacy::Error::NoEntry)
    ));
}
