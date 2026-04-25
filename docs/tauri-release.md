# Tauri App Release

The CLI and Skill release still uses `Release` / cargo-dist. The desktop app uses the separate `Tauri App Release` workflow so app installers can be rebuilt and uploaded without changing the CLI pipeline.

## Required GitHub Secrets

- `APPLE_CERTIFICATE`: Base64-encoded `.p12` export of `Developer ID Application: Dongping GUO (3VT538F8B6)`.
- `APPLE_CERTIFICATE_PASSWORD`: Password used when exporting the `.p12`.
- `KEYCHAIN_PASSWORD`: Temporary CI keychain password.
- `APPLE_API_KEY_ID`: `875SGQTLJ3`.
- `APPLE_API_ISSUER`: `9093015f-a519-449b-886a-cc514b563de6`.
- `APPLE_API_KEY_P8`: Full contents of `AuthKey_875SGQTLJ3.p8`.
- `HOMEBREW_TAP_TOKEN`: Token with push access to `Wangnov/homebrew-tap`, used to update the desktop app cask after signed DMGs are uploaded.

## Local macOS Build

```bash
export APPLE_SIGNING_IDENTITY=BD9222F93A500F1959BC342B432EEC7F4E886B12
export APPLE_API_KEY=875SGQTLJ3
export APPLE_API_ISSUER=9093015f-a519-449b-886a-cc514b563de6
export APPLE_API_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_875SGQTLJ3.p8"

npm --prefix apps/gpt-image-2-app ci
npm --prefix apps/gpt-image-2-app run prepare:sidecar
npm --prefix apps/gpt-image-2-app run tauri -- build --bundles app,dmg

DMG="target/release/bundle/dmg/GPT Image 2_0.2.5_aarch64.dmg"
xcrun notarytool submit "$DMG" \
  --key "$APPLE_API_KEY_PATH" \
  --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" \
  --team-id 3VT538F8B6 \
  --wait
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"
spctl -a -vvv -t open --context context:primary-signature "$DMG"
```

The SHA-1 identity avoids ambiguity when multiple `Developer ID Application: Dongping GUO (3VT538F8B6)` certificates are installed locally.

## CI Release

Run `Tauri App Release` manually with the same tag as the CLI release, for example `v0.2.5`. The workflow builds and uploads:

- macOS: signed and notarized `.app` / `.dmg` for Apple Silicon and Intel.
- Windows: NSIS `.exe`.
- Linux: AppImage, `.deb`, and `.rpm`.

For non-draft, non-prerelease runs, the workflow also updates `Casks/gpt-image-2.rb` in `Wangnov/homebrew-tap`. The cask points at the GitHub Release DMGs and uses GitHub's release asset SHA-256 digests, so macOS users can install with:

```bash
brew install --cask wangnov/tap/gpt-image-2
```
