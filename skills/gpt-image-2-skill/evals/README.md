# Evals

Two evaluation surfaces for this skill.

## `trigger-eval.json` — description trigger accuracy

20 user-style queries (10 should-trigger, 10 should-not-trigger near-misses) used to measure how reliably the SKILL.md `description` makes Claude pick this skill.

Run with the `skill-creator` description optimization loop:

```bash
# From an environment that has the skill-creator skill installed
python -m scripts.run_loop \
  --eval-set ./trigger-eval.json \
  --skill-path ../ \
  --model claude-opus-4-7 \
  --max-iterations 5 \
  --verbose
```

The loop splits 60% train / 40% test, calls `claude -p` to score whether each query triggers the skill, then proposes new descriptions based on what failed. Best description is selected by held-out test score.

## `evals.json` — prompt-level skill behavior

5 task prompts that exercise the skill's runtime surface:

| ID | Name | What it checks |
|---|---|---|
| 1 | `doctor-smoke` | `--json doctor` envelope shape and retry policy constants |
| 2 | `generate-transparent-png` | full OpenAI generate path, transparent background, 1024x1024 PNG output |
| 3 | `force-codex-provider` | `--provider codex` flag honored; tolerant of missing Codex auth |
| 4 | `edit-with-reference-image` | OpenAI multipart edit with `--ref-image` |
| 5 | `size-rejection` | client-side validation of `IMAGE_SIZE_MAX_EDGE` / `IMAGE_SIZE_MAX_TOTAL_PIXELS` |

Each entry has objective `assertions` — they read both the issued shell command and the resulting JSON envelope, so a programmatic grader (or a subagent) can check pass/fail without ambiguity.

## Prerequisites

For prompt-level evals to actually run, the host needs at least one provider ready:

- `OPENAI_API_KEY` for evals 1, 2, 4, 5
- `~/.codex/auth.json` for eval 3 (otherwise eval 3 accepts the auth-missing failure path)

For eval 4, place a real PNG at `/tmp/source-logo.png` before running.

Skip evals whose prerequisites are absent rather than marking them failed.
