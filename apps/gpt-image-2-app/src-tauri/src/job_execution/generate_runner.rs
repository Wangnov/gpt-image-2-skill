#![allow(unused_imports)]

use super::*;

pub(crate) fn run_generate_request(
    request: GenerateRequest,
    fallback_id: String,
    dir: PathBuf,
    stream: Option<StreamContext>,
) -> Result<Value, Value> {
    let provider_supports_n = provider_supports_n(request.provider.as_deref());
    let partials = Arc::new(Mutex::new(Vec::<Value>::new()));
    let partials_for_cb = partials.clone();
    let stream_for_cb = stream.clone();
    gpt_image_2_runtime::run_generate_request(
        request,
        fallback_id,
        dir,
        provider_supports_n,
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
