# JSON progress events (`--json-events`)

Pass `--json-events` to stream provider-agnostic progress events to **stderr** as JSONL (one event per line). Stdout still carries the final `--json` payload.

## Event envelope

Every event has at minimum:

```json
{
  "phase": "request_started",
  "message": "Human summary",
  "...": "phase-specific fields"
}
```

## Phases emitted by the Rust runtime

| Phase | When |
|---|---|
| `request_started` | OpenAI HTTP request or Codex SSE stream begins |
| `multipart_prepared` | OpenAI multipart edit body assembled |
| `retry_scheduled` | a retryable error occurred; a retry is queued |

Example `retry_scheduled` event (fields drawn from `execute_openai_with_retry`):

```json
{
  "phase": "retry_scheduled",
  "message": "Retrying after transient failure.",
  "retry_number": 1,
  "max_retries": 3,
  "delay_seconds": 1,
  "error": { "code": "...", "message": "..." }
}
```

Retry delay is exponential: `base_delay_seconds * 2^(retry_number - 1)`, so attempts wait `1s → 2s → 4s` with the default `base_delay_seconds = 1`.

## Codex raw SSE passthrough

When the provider is Codex and `--json-events` is on, the runtime additionally forwards every raw SSE event from `https://chatgpt.com/backend-api/codex/responses` to stderr via `emit_sse_event`. These follow the upstream Codex schema (typically `{"type": "...", "...": "..."}`) and let live consumers track `image_generation` tool progress, partial deltas, and tool completion.

## Consumption pattern

For an agent watching live progress while still parsing the final result:

```bash
gpt-image-2-skill --json --json-events images generate \
  --prompt "..." --out /tmp/out.png \
  > result.json \
  2> events.jsonl
```

- `result.json` — final `--json` envelope (success or error)
- `events.jsonl` — line-delimited progress events; safe to `tail -f`

## When to enable

Enable `--json-events` whenever:

- the user wants live feedback on long generations
- retry behavior needs to be observable
- a Codex pipeline needs to react to `image_generation` tool calls before the final response lands

Skip it for short, fire-and-forget invocations to avoid noisy stderr.
