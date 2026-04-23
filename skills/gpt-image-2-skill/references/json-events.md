# JSON progress events (`--json-events`)

Pass `--json-events` to stream progress events to **stderr** as JSONL (one event per line). Stdout still carries the final `--json` payload.

## Envelope

Every line shares the same outer shape:

```json
{
  "data":  { "...": "type-specific fields" },
  "kind":  "local" | "progress" | "sse",
  "seq":   1,
  "type":  "request_started"
}
```

- `seq` — monotonically increasing integer per command invocation
- `kind` — origin of the event:
  - `"local"` — emitted by the runtime before any network call (e.g. `request.started` marker)
  - `"progress"` — runtime-translated, provider-agnostic progress
  - `"sse"` — raw Codex Server-Sent-Events passthrough (Codex provider only)
- `type` — short event identifier; for `kind: "progress"` it matches `data.phase`

## Confirmed `type` values

| `kind` | `type` | When | Key fields in `data` |
|---|---|---|---|
| `local` | `request.started` | very first event of every invocation | `provider`, `endpoint` |
| `progress` | `request_started` | OpenAI HTTP request or Codex SSE stream begins | `phase`, `status: "running"`, `percent: 0`, `message`, `endpoint`, `provider` |
| `progress` | `multipart_prepared` | OpenAI multipart edit body assembled | `phase`, `status`, `transport: "multipart"` |
| `progress` | `request_completed` | upstream response received | `phase`, `status: "running"`, `percent: 95`, `created`, `image_count`, `message` |
| `progress` | `output_saved` | image files written to disk | `phase`, `status: "completed"`, `percent: 100`, `file_count`, `output: { bytes, files: [...], path }` |
| `progress` | `retry_scheduled` | retryable error occurred; a retry is queued | `phase`, `retry_number`, `max_retries`, `delay_seconds`, `error: { code, message }` |
| `sse` | upstream-defined | Codex provider only — every raw SSE event from `https://chatgpt.com/backend-api/codex/responses` | follows upstream Codex schema |

`status` walks `running` → `running` → `completed` across `request_started` → `request_completed` → `output_saved`. `percent` walks `0` → `95` → `100`. The final `--json` stdout payload includes `events.count` reflecting how many lines landed on stderr.

## Real example (OpenAI generate)

Captured from `images generate --provider openai ...`:

```jsonl
{"data":{"endpoint":"https://.../images/generations","provider":"openai"},"kind":"local","seq":1,"type":"request.started"}
{"data":{"endpoint":"...","message":"OpenAI image request sent.","percent":0,"phase":"request_started","provider":"openai","status":"running"},"kind":"progress","seq":2,"type":"request_started"}
{"data":{"created":1776926953,"image_count":1,"message":"OpenAI image response received.","percent":95,"phase":"request_completed","provider":"openai","status":"running"},"kind":"progress","seq":3,"type":"request_completed"}
{"data":{"file_count":1,"message":"Generated image files saved.","output":{"bytes":1574879,"files":[{"bytes":1574879,"index":0,"path":"/tmp/out.png"}],"path":"/tmp/out.png"},"percent":100,"phase":"output_saved","provider":"openai","status":"completed"},"kind":"progress","seq":4,"type":"output_saved"}
```

Four events: 1 local marker + 3 progress steps. A multipart edit inserts an extra `multipart_prepared` between `request.started` and `request_started`. A retried request inserts one or more `retry_scheduled` events between `request_started` and `request_completed`; retry delay is exponential (`base_delay_seconds * 2^(retry_number - 1)` → `1s → 2s → 4s` with the default `base_delay_seconds = 1`).

## Codex provider — extra events

The Codex provider drives a Server-Sent-Events stream against the responses endpoint, so two additional surfaces appear:

**Extra `progress` types** (translated by the runtime, in addition to the seven listed above):

| `type` | When |
|---|---|
| `response_created` | Codex `response.created` arrives |
| `response_completed` | Codex `response.completed` arrives |
| `output_item_done` | a single output item (image or text) finishes inside the response |

**`kind: "sse"` raw passthrough** — every upstream SSE event is forwarded unchanged with its original `type`. A typical Codex generate emits this superset:

| `type` | Meaning |
|---|---|
| `response.created` | response object created |
| `response.in_progress` | response is being computed |
| `response.output_item.added` | new output item started |
| `response.content_part.added` | new content part within an item |
| `response.image_generation_call.in_progress` | `image_generation` tool call started |
| `response.image_generation_call.generating` | model actively generating pixels |
| `response.image_generation_call.partial_image` | a partial image chunk available |
| `response.output_text.done` | text output finished |
| `response.content_part.done` | content part finished |
| `response.output_item.done` | output item finished |
| `response.completed` | full response finished |
| `keepalive` | empty SSE heartbeat |

A complete Codex `images generate` typically produces ~20 events (1 local + ~5 progress + ~14 SSE). Filter to the runtime-translated events with `jq -c 'select(.kind != "sse")'` if the SSE noise is unwanted.

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

Filter for a specific phase with:

```bash
jq -c 'select(.type == "request_completed")' events.jsonl
```

## When to enable

Enable `--json-events` whenever:

- the user wants live feedback on long generations
- retry behavior needs to be observable (`retry_scheduled` only appears with `--json-events`)
- a Codex pipeline needs to react to `image_generation` tool calls before the final response lands

Skip it for short, fire-and-forget invocations to avoid noisy stderr.
