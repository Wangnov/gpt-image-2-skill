fn preferred_locale(values: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    values.into_iter().flatten().find_map(|value| {
        let value = value.trim();
        (!value.is_empty()).then(|| value.to_owned())
    })
}

#[tauri::command]
pub fn system_locale() -> Option<String> {
    // LC_ALL overrides the message locale; C/POSIX explicitly select English.
    // On platforms without these variables the frontend uses the WebView locale.
    preferred_locale(["LC_ALL", "LC_MESSAGES", "LANG"].map(|name| std::env::var(name).ok()))
}

#[cfg(test)]
mod tests {
    use super::preferred_locale;

    #[test]
    fn respects_message_locale_precedence_and_explicit_c_locale() {
        assert_eq!(
            preferred_locale([Some("C".into()), Some("zh_CN.UTF-8".into()), None]),
            Some("C".into())
        );
        assert_eq!(
            preferred_locale([None, Some("en_US.UTF-8".into()), Some("zh_CN.UTF-8".into())]),
            Some("en_US.UTF-8".into())
        );
    }

    #[test]
    fn skips_empty_values_and_defers_to_webview_when_unset() {
        assert_eq!(
            preferred_locale([Some(" ".into()), None, Some(" zh_CN.UTF-8 ".into())]),
            Some("zh_CN.UTF-8".into())
        );
        assert_eq!(preferred_locale([None, None, None]), None);
    }
}
