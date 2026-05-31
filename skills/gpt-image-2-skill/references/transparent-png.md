# Transparent PNG playbook

Use this reference when the user asks for a final transparent-background PNG. The CLI is a tool layer; the Agent is responsible for choosing prompts, backgrounds, and retry strategy.

## Command roles

| Command | Role |
|---|---|
| `transparent generate` | Prompt-to-final PNG. Generates one controlled matte source, extracts alpha locally, verifies, and fails if the final PNG is not usable. |
| `transparent extract` | Local alpha extraction from controlled source images. Use this for difficult assets, custom source prompts, or multi-background flows. It is not a general-purpose remover for arbitrary photos. |
| `transparent verify` | Final acceptance gate. Use `--strict` with the right `--profile` before delivery. |

Do not treat provider-native `--background transparent` as the reliable path, especially with Codex. Controlled backgrounds plus local extraction are the reliable path.

A transparent deliverable is valid only if the final file has a real PNG alpha channel and passes quality verification. Visual transparency, white backgrounds, and checkerboard patterns are not sufficient.

## Default loop

1. Start with `transparent generate` for ordinary isolated assets.
2. If verification fails, keep sources with `--report-dir` and inspect the source matte.
3. Change the matte color or source prompt, then call `transparent extract`; prefer `--matte-color auto` for AI-generated flat backgrounds.
4. For translucency or glow, create black and white variants and use dual extraction.
5. Run `transparent verify --profile <profile> --strict` on the final PNG. If the PNG came from chroma extraction, include `--expected-matte-color <matte>`.
6. Deliver only the verified PNG unless the user asked for diagnostics.

## Strict profiles

`--strict` is profile-based. The default `generic` profile checks common alpha/file validity without over-policing unusual assets. Select a stricter profile when the asset type is known:

| Profile | Use for | Extra strictness |
|---|---|---|
| `generic` | unknown or unusual assets | PNG alpha exists, real transparent area exists, checkerboard rejected |
| `icon` | clean single-subject icons and props | clean opaque core, enough margin, low stray pixels |
| `product` | product/object cutouts | clean opaque core, enough margin, low residue/noise |
| `sticker` | decals, badges, multi-detail props | allows more intentional small components than `icon` |
| `seal` | stamps, seals, logos with inner marks | allows split components such as ring + center symbol |
| `translucent` | glass, liquid, crystal | partial alpha required; alpha max does not need to be 255 |
| `glow` | light ribbons, flame, smoke, particles | partial alpha required; transparent margin required |
| `shadow` | soft shadow assets | partial alpha required; transparent margin required |
| `effect` | hard-alpha particles, bursts, UI effects | transparent margin without requiring partial alpha |

Examples:

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent verify --input /tmp/sword.png --profile icon --strict

node scripts/gpt_image_2_skill.cjs --json \
  transparent verify --input /tmp/stamp.png --profile seal --strict
```

## Prompt rules for controlled mattes

Use the prompt to control the scene, not to request alpha directly:

- Ask for one isolated asset, centered, with clear margin.
- Ask for a perfectly flat, uniform background color.
- Forbid gradients, texture, scenery, shadows, reflections, labels, frames, and contact shadows unless they are part of the asset.
- Pick a background color that does not appear in the object.
- If a color contaminates edges, retry with magenta, cyan, blue, green, black, or white.
- If the source was AI-generated, do not assume the requested matte is exact. Let extraction sample it with `--matte-color auto`.

Example source prompt:

```text
a polished fantasy sword game asset, centered, full blade visible, no text, no frame.
Render on a perfectly flat pure magenta background. No shadows, gradients, texture, scenery, reflections, or background-colored details.
```

## Method selection

### Opaque entities

Use a single chroma matte.

```bash
node scripts/gpt_image_2_skill.cjs --json --json-events \
  transparent generate \
  --prompt "a polished fantasy sword game asset, no text, no frame" \
  --out /tmp/sword.png --size 2K --quality high
```

If the object contains green, avoid green:

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent extract --method chroma \
  --input /tmp/source-magenta.png --matte-color auto \
  --out /tmp/asset.png --strict
```

`--matte-color auto` samples the actual source background from image edges and reports the sampled color as `extraction.matte_color` with `matte_color_source: "auto-sampled"`. Use explicit `--matte-color magenta` or `--matte-color '#ff00ff'` only when the source background is known to be exact.

For broad material behavior, add `--material standard`, `soft-3d`, `flat-icon`, `sticker`, or `glow`. These presets tune chroma `threshold`, `softness`, and `spill_suppression`; manual flags override the preset.

### Hair, fur, lace, chains, nets

Use higher resolution and a matte color with strong contrast. Thin structures are sensitive to background spill.

Good source prompt details:

- `high resolution`
- `crisp separated strands`
- `no shadow`
- `clear margin around every edge`
- `flat pure magenta/cyan background`

The chroma extractor applies matte decontamination and default `--spill-suppression 0.85`. Increase toward `1` only for stubborn colored spill; lower toward `0` only when it visibly damages legitimate edge color. For soft 3D, clay-like, glossy, or painterly edges, try `--material soft-3d` before hand-tuning individual values.

Retry by changing matte color if verification warns about edges or the visual preview still shows residue.

### Glass, liquid, transparent plastic, holograms

Use dual-background extraction. Generate or edit two aligned source images:

- one on pure black
- one on pure white

Dual extraction requires the dark and light images to be geometrically identical or near-identical. Do not independently generate black-background and white-background variants unless the provider can preserve geometry. Prefer generating one source asset, then using reference-image editing or background replacement to create the paired background.

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent extract --method dual \
  --dark-image /tmp/glass-black.png \
  --light-image /tmp/glass-white.png \
  --out /tmp/glass.png --strict
```

Dual extraction preserves semi-transparency better than chroma extraction.
The CLI reports `dual_alignment` diagnostics (`score`, `passed`, `negative_delta_ratio`, `delta_channel_noise`, and `color_space`). If alignment looks bad, regenerate the pair through an edit/reference flow.

### Glow, flame, smoke, mist, magic particles

Prefer dual extraction. The final PNG should have non-zero `partial_pixels`.

Source prompt rules:

- Keep the effect away from image edges unless edge cutoff is intended.
- Avoid background texture.
- Ask for the same composition on black and white backgrounds.
- Use `transparent verify` and check `partial_pixels`, `alpha_max`, and `warnings`.

Use `--profile effect` instead of `glow` for hard-alpha bursts, stars, coins, arrows, or particles where partial alpha is not required.

### Shadows

Decide if the shadow belongs to the asset.

- If no: forbid contact shadows in the source prompt.
- If yes: use enough margin and either chroma extraction for simple hard shadows or dual extraction for soft translucent shadows.

## Reference-image style lock

`transparent generate` is prompt-only. If you need a reference image to lock style, generate or edit a controlled matte source first, then extract:

```bash
node scripts/gpt_image_2_skill.cjs --json --json-events \
  images edit \
  --ref-image /tmp/style-lock-rgb.png \
  --prompt "Use the reference only for material, palette, lighting, and proportions. Create a new centered asset on a flat magenta background. Do not preserve the reference subject. No text." \
  --out /tmp/source-magenta.png --format png --size 2K

node scripts/gpt_image_2_skill.cjs --json \
  transparent extract \
  --input /tmp/source-magenta.png \
  --matte-color auto \
  --profile sticker \
  --out /tmp/final.png \
  --strict
```

Use a flat RGB reference image for style lock. A transparent PNG reference may carry premultiplied edges or alpha artifacts into the edit; flatten it first when the alpha is not semantically important.

## Text and labels

GPT Image 2 can render accurate UI text, labels, scores, combo numbers, and button captions when they are part of the desired bitmap. Put the exact wording or numbering in the prompt and verify the output visually. Render text separately in the host app, canvas layer, or design tool only when it must stay editable, localizable, programmatically changeable, or perfectly consistent across many generated variants.

## Verification

Always verify:

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent verify --input /tmp/asset.png --profile icon --strict
```

Important fields:

| Field | Meaning |
|---|---|
| `passed` | The CLI acceptance gate. Deliver only if true. |
| `profile` | The strictness profile used for quality gating. |
| `input_has_alpha` | The file is encoded with alpha. |
| `alpha_min` | Should be near 0 for a real transparent background. |
| `alpha_max` | Should be greater than 20; fully semi-transparent assets do not need 255. |
| `transparent_ratio` | Confirms there is actual transparent background area. |
| `partial_pixels` | Important for glow, smoke, glass, hair edges, and shadows. |
| `checkerboard_detected` | Reject visual fake transparency. |
| `touches_edge` / `edge_margin_px` | Detect edge contact and likely cropping. |
| `stray_pixel_count` / `largest_component_ratio` | Detect isolated background fragments. |
| `matte_residue_checked` | True only when verification received `--expected-matte-color`. If false for a chroma output, residue was not checked. |
| `matte_residue_score` | Detect expected matte-color contamination when `--expected-matte-color` is provided. |
| `halo_score` | Detect strong black/white halos in semi-transparent pixels. |
| `transparent_rgb_scrubbed` | Confirms fully transparent pixels have RGB cleared. |
| `alpha_health_score` | File/alpha-channel health score independent of visual residue. |
| `residue_score` | Visual cleanup score for stray pixels, matte residue, halos, and edge contact. |
| `quality_score` | Summary score for ranking candidates. |
| `failure_reasons` | Machine-readable reasons to drive retries. |
| `warnings` | Edge contact or missing semi-transparency warnings. |

When verifying chroma output, pass the matte if known:

```bash
node scripts/gpt_image_2_skill.cjs --json \
  transparent verify \
  --input /tmp/asset.png \
  --expected-matte-color magenta \
  --profile product \
  --strict
```

If `matte_residue_checked` is false, a passing result does not prove the edge is free of the source matte color.

## Failure handling

| Symptom | Action |
|---|---|
| `transparent_verification_failed` | Do not deliver. Retry with a different matte or dual extraction. |
| Edge residue | Use `--matte-color auto`, `--spill-suppression`, change matte color, increase contrast, or reduce source shadows. |
| Object partially removed | Matte color appears in the object; choose a different matte. |
| No semi-transparent pixels for glow/glass | Use dual extraction instead of chroma. |
| Dual extraction looks noisy | The two source images are not aligned; regenerate via edit/reference flow. |
| Object touches image edge | Regenerate with more margin or larger canvas. |
| `checkerboard_detected` | Reject and regenerate with controlled matte; checkerboard is not alpha. |
| `transparent_rgb_scrubbed` is false | Re-run extraction so fully transparent pixels are RGB-scrubbed. |
| `failure_reasons` includes `profile_requires_partial_alpha` | Use dual extraction or a translucent/glow/shadow source strategy. |
| `failure_reasons` includes `too_many_stray_pixels` | Retry with cleaner matte, stronger margin, or use `sticker`, `seal`, or `effect` if multiple components are intentional. |

Retry tree:

1. If no alpha channel: run `transparent extract` or reject provider-native transparency.
2. If checkerboard is detected: reject it as fake transparency and regenerate with controlled matte.
3. If matte residue is high: retry with a different matte color.
4. If the subject touches the edge: regenerate with larger margin or canvas.
5. If transparent area is too small: strengthen isolated-subject and margin prompt.
6. If stray pixels are high: retry with a cleaner matte or inspect whether particles are intentional.
7. If partial alpha is zero but the asset should be soft/translucent: use dual extraction.
8. If dual alignment is poor: recreate paired backgrounds from one source using image edit/reference flow.

Keep source files only while iterating:

```bash
node scripts/gpt_image_2_skill.cjs --json --json-events \
  transparent generate \
  --prompt "..." --out /tmp/final.png \
  --report-dir /tmp/transparent-debug
```
