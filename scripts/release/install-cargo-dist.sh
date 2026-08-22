#!/usr/bin/env bash
set -euo pipefail

# Keep the release tool immutable: both the version and each platform archive
# digest are reviewed in this repository. Do not replace this with pipe-to-shell.
version="0.31.0"
platform="$(uname -s)-$(uname -m)"

case "$platform" in
  Darwin-arm64)
    asset="cargo-dist-aarch64-apple-darwin.tar.xz"
    expected_sha256="decb01c64c12501931c3cac3111b368a7f48adf8d9e65455c08e5757b9a1fd6f"
    ;;
  Darwin-x86_64)
    asset="cargo-dist-x86_64-apple-darwin.tar.xz"
    expected_sha256="fd4d8f9f07802359cbcdc52bac3abd7d5201c4b73a7cbcdd6faca2232a389f0c"
    ;;
  Linux-aarch64 | Linux-arm64)
    asset="cargo-dist-aarch64-unknown-linux-gnu.tar.xz"
    expected_sha256="382cc29ff91ef12a5bf78ad8ee1804661d24e2fbe64b1bdedd6078723b677ae5"
    ;;
  Linux-x86_64)
    asset="cargo-dist-x86_64-unknown-linux-gnu.tar.xz"
    expected_sha256="cd355dab0b4c02fb59038fef87655550021d07f45f1d82f947a34ef98560abb8"
    ;;
  *)
    echo "Unsupported cargo-dist installer platform: $platform" >&2
    exit 1
    ;;
esac

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/gpt-image-2-cargo-dist.XXXXXX")"
cleanup() {
  find "$download_dir" -depth -type f -delete
  find "$download_dir" -depth -type d -exec rmdir {} \;
}
trap cleanup EXIT

archive_path="$download_dir/$asset"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  --retry 3 --output "$archive_path" \
  "https://github.com/axodotdev/cargo-dist/releases/download/v${version}/${asset}"

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256="$(sha256sum "$archive_path" | awk '{print $1}')"
else
  actual_sha256="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
fi
if [[ "$actual_sha256" != "$expected_sha256" ]]; then
  echo "cargo-dist archive checksum mismatch for $asset" >&2
  exit 1
fi

tar -xJf "$archive_path" -C "$download_dir"
binary_path="$(find "$download_dir" -type f -name dist -print -quit)"
if [[ -z "$binary_path" ]]; then
  echo "Verified cargo-dist archive did not contain the dist binary" >&2
  exit 1
fi

cargo_bin_dir="${CARGO_HOME:-$HOME/.cargo}/bin"
mkdir -p "$cargo_bin_dir"
install -m 0755 "$binary_path" "$cargo_bin_dir/dist"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$cargo_bin_dir" >> "$GITHUB_PATH"
fi
"$cargo_bin_dir/dist" --version
