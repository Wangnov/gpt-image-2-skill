#![allow(unused_imports)]

use super::*;

pub(crate) fn edit_region_mode_for_request(request: &EditRequest) -> String {
    gpt_image_2_runtime::edit_region_mode_for_request(request, |provider| {
        provider_edit_region_mode(provider)
    })
}

pub(crate) fn write_edit_inputs(
    request: &EditRequest,
    dir: &std::path::Path,
) -> Result<(Vec<PathBuf>, Option<PathBuf>, String), String> {
    let edit_region_mode = edit_region_mode_for_request(request);
    gpt_image_2_runtime::write_edit_inputs_with_region_mode(request, dir, &edit_region_mode)
}

pub(crate) fn edit_request_metadata(request: &EditRequest) -> Value {
    let edit_region_mode = edit_region_mode_for_request(request);
    gpt_image_2_runtime::edit_request_metadata_with_region_mode(request, &edit_region_mode)
}

pub(crate) fn run_edit_request(
    request: EditRequest,
    fallback_id: String,
    dir: PathBuf,
    stream: Option<StreamContext>,
) -> Result<Value, Value> {
    let provider_supports_n = provider_supports_n(request.provider.as_deref());
    let edit_region_mode = edit_region_mode_for_request(&request);
    let partials = Arc::new(Mutex::new(Vec::<Value>::new()));
    let partials_for_cb = partials.clone();
    let stream_for_cb = stream.clone();
    gpt_image_2_runtime::run_edit_request(
        request,
        fallback_id,
        dir,
        provider_supports_n,
        edit_region_mode,
        move |index, payload| {
            if let Some(ctx) = &stream_for_cb {
                let mut list = partials_for_cb
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                apply_partial_output(ctx, &mut list, index, payload);
            }
        },
    )
}
