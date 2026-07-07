#![allow(unused_imports)]

use super::*;

use super::*;

fn openai_compatible_provider() -> ProviderConfig {
    ProviderConfig {
        provider_type: "openai-compatible".to_string(),
        api_base: Some("https://example.com/v1".to_string()),
        endpoint: None,
        model: Some("gpt-image-2".to_string()),
        credentials: BTreeMap::new(),
        supports_n: Some(false),
        edit_region_mode: Some("reference-hint".to_string()),
        proxy: None,
    }
}

#[test]
fn configured_openai_name_overrides_builtin_capabilities() {
    let mut config = AppConfig::default();
    config
        .providers
        .insert("openai".to_string(), openai_compatible_provider());

    assert!(!provider_supports_n_from_config(
        Some(&config),
        Some("openai")
    ));
    assert_eq!(
        provider_edit_region_mode_from_config(Some(&config), Some("openai")),
        "reference-hint"
    );
}

#[test]
fn default_provider_uses_configured_openai_capabilities() {
    let mut config = AppConfig {
        default_provider: Some("openai".to_string()),
        ..Default::default()
    };
    config
        .providers
        .insert("openai".to_string(), openai_compatible_provider());

    assert!(!provider_supports_n_from_config(Some(&config), None));
    assert_eq!(
        provider_edit_region_mode_from_config(Some(&config), None),
        "reference-hint"
    );
}

#[test]
fn builtin_openai_capabilities_are_fallback_when_config_absent() {
    let config = AppConfig::default();

    assert!(provider_supports_n_from_config(
        Some(&config),
        Some("openai")
    ));
    assert_eq!(
        provider_edit_region_mode_from_config(Some(&config), Some("openai")),
        "native-mask"
    );
}

#[test]
fn tauri_storage_defaults_migrate_downloads_to_result_directory() {
    let mut config = AppConfig::default();
    config.paths.default_export_dir.mode = gpt_image_2_core::ExportDirMode::Downloads;

    normalize_product_storage_defaults(&mut config);

    assert_eq!(
        config.paths.default_export_dir.mode,
        gpt_image_2_core::ExportDirMode::ResultLibrary
    );
    assert!(config.paths.default_export_dir.path.is_none());
}

#[test]
fn tauri_storage_defaults_keep_explicit_downloads_save_directory() {
    let mut config = AppConfig::default();
    config.paths.default_export_dir.mode = gpt_image_2_core::ExportDirMode::Downloads;
    config.paths.result_library_dir.mode = gpt_image_2_core::PathMode::Custom;
    config.paths.result_library_dir.path = Some(PathBuf::from("/tmp/GPT Image 2"));

    normalize_product_storage_defaults(&mut config);

    assert_eq!(
        config.paths.default_export_dir.mode,
        gpt_image_2_core::ExportDirMode::Downloads
    );
}

#[test]
fn sync_result_library_uses_selected_standard_save_folder() {
    let mut paths = AppConfig::default().paths;
    paths.default_export_dir.mode = gpt_image_2_core::ExportDirMode::Downloads;
    let preview = AppConfig {
        paths: paths.clone(),
        ..Default::default()
    };
    let expected = product_default_export_dir(Some(&preview), ProductRuntime::Tauri);

    sync_result_library_to_default_export_dir(&mut paths);

    assert_eq!(
        paths.result_library_dir.mode,
        gpt_image_2_core::PathMode::Custom
    );
    assert_eq!(paths.result_library_dir.path, Some(expected));
}

#[test]
fn export_skips_copy_when_source_is_already_saved_under_destination() {
    let root = std::env::temp_dir().join(format!("gpt-image-2-export-test-{}", std::process::id()));
    let nested = root.join("job");
    fs::create_dir_all(&nested).unwrap();
    let source = nested.join("out.png");
    fs::write(&source, b"png").unwrap();

    let exported = export_files_into_dir(vec![source.display().to_string()], &root).unwrap();

    assert_eq!(exported, vec![source.display().to_string()]);
    assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    let _ = fs::remove_dir_all(root);
}
