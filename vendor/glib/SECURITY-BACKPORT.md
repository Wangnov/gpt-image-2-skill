# glib 0.18.5 security backport

Source: crates.io glib 0.18.5 (MIT), vendored without Cargo cache metadata.
Advisory: https://github.com/advisories/GHSA-wrw7-89jp-8q8g

Tauri 2 uses GTK3, whose crates require glib 0.18. Updating glib to 0.20 alone is incompatible.
The only source change is in src/variant_iter.rs: make the output pointer mutable and pass &mut p to g_variant_get_child. This removes mutation through a shared reference. All original license files are retained.

Regression: cargo test --manifest-path vendor/glib/Cargo.toml --release test_variant_str_iter
Run with optimizations because the undefined behavior manifested in optimized builds.
Remove this patch when the Tauri GTK dependency chain supports a patched upstream release.
