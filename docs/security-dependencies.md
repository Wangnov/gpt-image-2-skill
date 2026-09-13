# Dependency advisory remediation — 2026-09-13

- Vitest and @vitest/mocker: update both npm workspaces to patched 4.1.11 or later.
- sharp/libheif: update Wrangler dependency graph to sharp 0.35.4.
- anyhow RUSTSEC-2026-0190 and event-listener RUSTSEC-2026-0221: update to patched versions (>=1.0.103 and >=5.4.2).
- fflate ZIP64 denial of service: update to 0.8.3.
- glib GHSA-wrw7-89jp-8q8g: source backport in vendor/glib; see its SECURITY-BACKPORT.md. Workspace patch applies to the shipped Tauri application. Publishing a library to crates.io does not propagate workspace patches to consumers; the published CLI/core/web crates do not depend on glib.
- rand RUSTSEC-2026-0097: rand 0.8 is already 0.8.6; remaining 0.7.3 is a build dependency of phf_generator through Tauri utilities. The required log feature is disabled. CI checks the complete resolved feature graph and fails if it becomes enabled. This is a checked non-applicability assessment, not a claim that rand 0.7.3 itself is patched.

GitHub version-based alerts can remain for vendored glib or rand despite these mitigations. Do not dismiss without rechecking the guard and patched-source tests.
