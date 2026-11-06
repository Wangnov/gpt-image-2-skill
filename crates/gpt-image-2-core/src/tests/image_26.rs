use super::*;

fn shared_args(extra: &[&str]) -> SharedImageArgs {
    let mut argv = vec![
        CLI_NAME, "images", "generate", "--prompt", "test", "--out", "result",
    ];
    argv.extend_from_slice(extra);
    let cli = Cli::try_parse_from(argv).unwrap();
    let Commands::Images(command) = cli.command else {
        panic!()
    };
    let ImagesSubcommand::Generate(args) = command.images_command else {
        panic!()
    };
    args.shared
}

fn selection(kind: ProviderKind) -> ProviderSelection {
    ProviderSelection {
        requested: "test".into(),
        resolved: "test".into(),
        reason: "test".into(),
        kind,
        api_base: DEFAULT_OPENAI_API_BASE.into(),
        codex_endpoint: DEFAULT_CODEX_ENDPOINT.into(),
        default_model: DEFAULT_OPENAI_MODEL.into(),
        supports_n: false,
        edit_region_mode: EDIT_REGION_NATIVE_MASK.into(),
        preset: PROVIDER_PRESET_CUSTOM.into(),
        image_transport: IMAGE_TRANSPORT_OPENAI_SYNC.into(),
        poll_interval_seconds: DEFAULT_IMAGE_POLL_INTERVAL_SECONDS,
        poll_timeout_seconds: DEFAULT_IMAGE_POLL_TIMEOUT_SECONDS,
    }
}

#[test]
fn image_26_options_and_svg_author_are_independent() {
    let args = shared_args(&[
        "--format",
        "svg",
        "--quality",
        "low",
        "--complexity",
        "high",
        "--svg-model",
        "author-model",
        "--svg-reasoning-effort",
        "low",
        "--safety-identifier",
        "hashed-user",
    ]);
    let mut body = json!({});
    apply_openai_image_options(&mut body, &args);
    assert_eq!(body["complexity"], "high");
    assert_eq!(
        body["svg"],
        json!({"model": "author-model", "reasoning": {"effort": "low"}})
    );
    assert_eq!(body["safety_identifier"], "hashed-user");
    let summary = summarize_image_request_options(
        "openai",
        "generate",
        DEFAULT_OPENAI_MODEL,
        &args,
        0,
        false,
        None,
    );
    assert_eq!(summary["complexity"], "high");
    assert_eq!(summary["safety_identifier_present"], true);
    assert!(summary.get("safety_identifier").is_none());
}

#[test]
fn gif_frame_dimensions_do_not_use_the_still_image_minimum() {
    let args = shared_args(&[
        "--format",
        "gif",
        "--size",
        "256x256",
        "--frame-count",
        "2",
        "--frame-duration-ms",
        "225",
    ]);
    validate_image_options(
        &selection(ProviderKind::OpenAi),
        &args,
        "generate",
        None,
        None,
    )
    .unwrap();
    let mut body = json!({});
    apply_openai_image_options(&mut body, &args);
    assert_eq!(body["frame_count"], 2);
    assert_eq!(body["frame_duration_ms"], 225);
    let still = shared_args(&["--size", "256x256"]);
    assert!(
        validate_image_options(
            &selection(ProviderKind::OpenAi),
            &still,
            "generate",
            None,
            None
        )
        .is_err()
    );
}

#[test]
fn incompatible_options_are_rejected_before_batch_fanout() {
    type InvalidCase<'a> = (&'a [&'a str], &'a str, Option<&'a str>, Option<&'a str>);
    let cases: &[InvalidCase<'_>] = &[
        (&["--format", "svg", "--n", "2"], "generate", None, None),
        (&["--format", "svg"], "edit", None, None),
        (
            &["--format", "gif", "--compression", "50"],
            "generate",
            None,
            None,
        ),
        (&["--frame-count", "2"], "generate", None, None),
        (&["--svg-model", "author"], "generate", None, None),
        (&["--format", "gif"], "edit", Some("mask.png"), None),
        (&[], "edit", Some("mask.png"), Some("markup.png")),
        (
            &["--format", "jpeg", "--background", "transparent"],
            "generate",
            None,
            None,
        ),
    ];
    for (flags, operation, mask, markup) in cases {
        let args = shared_args(flags);
        assert!(
            validate_image_options(
                &selection(ProviderKind::OpenAi),
                &args,
                operation,
                *mask,
                *markup
            )
            .is_err(),
            "{flags:?}"
        );
    }
}

#[test]
fn image_26_features_never_disappear_on_other_providers_or_pinned_legacy_models() {
    for flags in [
        vec!["--complexity", "low"],
        vec!["--format", "gif"],
        vec!["--format", "svg"],
    ] {
        let args = shared_args(&flags);
        for kind in [ProviderKind::Codex, ProviderKind::Atlas] {
            assert_eq!(
                validate_image_options(&selection(kind), &args, "generate", None, None)
                    .unwrap_err()
                    .code,
                "unsupported_option"
            );
        }
        for model in ["gpt-image-2", "gpt-image-2.5-flare"] {
            let mut pinned = args.clone();
            pinned.model = Some(model.into());
            assert!(
                validate_image_options(
                    &selection(ProviderKind::OpenAi),
                    &pinned,
                    "generate",
                    None,
                    None
                )
                .is_err()
            );
        }
    }
    let args = shared_args(&["--model", "custom-image-model", "--complexity", "low"]);
    validate_image_options(
        &selection(ProviderKind::OpenAi),
        &args,
        "generate",
        None,
        None,
    )
    .unwrap();
}

fn png(width: u32, height: u32, alpha: u8) -> Vec<u8> {
    let image = image::RgbaImage::from_pixel(width, height, image::Rgba([255, 0, 0, alpha]));
    let mut cursor = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut cursor, image::ImageFormat::Png)
        .unwrap();
    cursor.into_inner()
}

#[test]
fn markup_requires_transparency_matching_dimensions_and_png() {
    let first = png(16, 16, 255);
    validate_markup_images(&first, &png(16, 16, 0), "image/png").unwrap();
    for (bytes, mime) in [
        (png(16, 16, 255), "image/png"),
        (png(32, 16, 0), "image/png"),
        (png(16, 16, 0), "image/jpeg"),
    ] {
        assert_eq!(
            validate_markup_images(&first, &bytes, mime)
                .unwrap_err()
                .code,
            "markup_invalid"
        );
    }
}

#[test]
fn raw_edit_file_ids_select_json_instead_of_being_dropped() {
    for body in [
        json!({"images": [{"file_id": "file-source"}]}),
        json!({"images": [{"image_url": "https://example.com/a.png"}], "markup": {"file_id": "file-markup"}}),
        json!({"mask": {"file_id": "file-mask"}}),
    ] {
        assert!(openai_edit_requires_json(&body));
    }
    assert!(!openai_edit_requires_json(
        &json!({"images": [{"image_url": "data:image/png;base64,AAAA"}]})
    ));
}

#[test]
fn svg_and_gif_bytes_are_saved_without_raster_conversion() {
    let dir = tempfile::tempdir().unwrap();
    let svg = b"\xef\xbb\xbf<?xml version=\"1.0\"?>\n<!-- icon -->\n<svg xmlns=\"http://www.w3.org/2000/svg\"><path d=\"M0 0h1v1z\"/></svg>";
    for (name, bytes, extension) in [
        ("vector", svg.as_slice(), "svg"),
        ("animation", b"GIF89a\x01\x00\x01\x00".as_slice(), "gif"),
    ] {
        let saved = save_image(&dir.path().join(name), bytes).unwrap();
        assert_eq!(saved.extension().unwrap(), extension);
        assert_eq!(fs::read(saved).unwrap(), bytes);
        assert_eq!(output_extension(Some(extension)), extension);
    }
    assert_eq!(detect_extension(b"<svgish>not svg</svgish>"), ".bin");
}

#[test]
fn raw_svg_and_gif_constraints_apply_before_transport() {
    for body in [
        json!({"output_format": "svg", "n": 2}),
        json!({"output_format": "gif", "stream": true}),
        json!({"output_format": "svg", "partial_images": 1}),
        json!({"output_format": "gif", "mask": {"file_id": "file-mask"}}),
        json!({"markup": {}, "prompt_rewriter": true}),
    ] {
        assert!(validate_openai_body_options(&body, "generate").is_err());
    }
    validate_openai_body_options(&json!({"output_format": "svg", "n": 1}), "generate").unwrap();
}

fn transport_round_trip(body: &Value, operation: &str) -> String {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let mut provider = selection(ProviderKind::OpenAi);
    provider.api_base = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let (mut stream, _) = loop {
            match listener.accept() {
                Ok(value) => break value,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "No provider request received"
                    );
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("{error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut reader = BufReader::new(&mut stream);
        let mut headers = String::new();
        let mut content_length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                content_length = value.trim().parse::<usize>().unwrap();
            }
            headers.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        let mut body = vec![0; content_length];
        reader.read_exact(&mut body).unwrap();
        let response = r#"{"created":1,"data":[{"b64_json":"YWJj"}]}"#;
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).unwrap();
        format!("{headers}{}", String::from_utf8_lossy(&body))
    });
    let auth = OpenAiAuthState {
        api_key: "local-test-credential".into(),
        source: "test".into(),
    };
    let proxy = ProxyConfig {
        mode: ProxyMode::None,
        ..Default::default()
    };
    let result = request_openai_with_transport(
        &provider,
        operation,
        &auth,
        body,
        &mut JsonEventLogger::new(false),
        None,
        &proxy,
    );
    let captured = server.join().unwrap();
    assert!(result.is_ok(), "{result:?}");
    captured
}

#[test]
fn multipart_preserves_markup_complexity_animation_and_safety_fields() {
    let image = STANDARD.encode(png(16, 16, 255));
    let markup = STANDARD.encode(png(16, 16, 0));
    let captured = transport_round_trip(
        &json!({
            "model": "gpt-image-2.6-flare", "prompt": "Animate the circled object",
            "images": [{"image_url": format!("data:image/png;base64,{image}")}],
            "markup": {"image_url": format!("data:image/png;base64,{markup}")},
            "output_format": "gif", "complexity": "low", "frame_count": 2,
            "frame_duration_ms": 200, "safety_identifier": "hashed-user"
        }),
        "edit",
    );
    assert!(captured.starts_with("POST /v1/images/edits "));
    assert!(captured.contains("multipart/form-data"));
    for (name, value) in [
        ("complexity", "low"),
        ("frame_count", "2"),
        ("frame_duration_ms", "200"),
        ("safety_identifier", "hashed-user"),
    ] {
        assert!(
            captured.contains(&format!("name=\"{name}\"\r\n\r\n{value}\r\n")),
            "{name} missing from multipart"
        );
    }
    assert!(captured.contains("name=\"markup\"; filename=\"markup.png\""));
    assert!(captured.contains("name=\"image[]\""));
}

#[test]
fn raw_file_ids_reach_the_edit_endpoint_as_json() {
    let body = json!({
        "model": "gpt-image-2.6-sunburst", "prompt": "Recolor the circled object",
        "images": [{"file_id": "file-original"}], "markup": {"file_id": "file-annotation"},
        "complexity": "medium"
    });
    let captured = transport_round_trip(&body, "edit");
    assert!(
        captured
            .to_ascii_lowercase()
            .contains("content-type: application/json")
    );
    let (_, encoded) = captured.split_once("\r\n\r\n").unwrap();
    assert_eq!(serde_json::from_str::<Value>(encoded).unwrap(), body);
}
