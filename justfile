set shell := ["bash", "-euo", "pipefail", "-c"]

# Show available project commands.
default:
    just --list

# Install the CLI from the local workspace.
install-local:
    cargo install --path crates/gpt-image-2-skill --locked --force

# Sync the installable skill bundle from the source templates.
sync-skill:
    node scripts/sync_skill_bundle.cjs

# Smoke-test the installable skill bundle.
smoke-skill-install:
    node scripts/smoke_skill_install.cjs

# Run Rust tests for the CLI crate.
test:
    cargo test -p gpt-image-2-skill

# Build the CLI crate in debug mode.
build:
    cargo build -p gpt-image-2-skill

# Build the CLI crate in release mode.
build-release:
    cargo build --release -p gpt-image-2-skill

# Build or check npm platform package manifests.
npm-matrix:
    node scripts/npm/build-matrix.mjs

# Type-check the Tauri/Web frontend.
app-typecheck:
    npm --prefix apps/gpt-image-2-app run typecheck

# Build the Tauri/Web frontend.
app-build:
    npm --prefix apps/gpt-image-2-app run build

# Build the HTTP-backed Web frontend.
app-build-http:
    npm --prefix apps/gpt-image-2-app run build:http

# Run the browser transport tests.
app-test-browser:
    npm --prefix apps/gpt-image-2-app run test:browser

# Run the Cloudflare relay Worker tests and type-check.
relay-test:
    npm --prefix workers/gpt-image-2-relay run test
    npm --prefix workers/gpt-image-2-relay run typecheck

# Dry-run the Cloudflare relay Worker deployment.
relay-dry:
    npm --prefix workers/gpt-image-2-relay run dry-run

# Deploy the Cloudflare relay Worker route for image.codex-pool.com/api/relay*.
relay-deploy:
    npm --prefix workers/gpt-image-2-relay run deploy

# Start the HTTP-backed frontend dev server.
dev-http-frontend:
    cd apps/gpt-image-2-app && VITE_GPT_IMAGE_2_API_BASE=/api npm run dev

# Start the Docker HTTP backend used by the frontend dev server.
dev-http-backend image="gpt-image-2-web:latest":
    mkdir -p "$HOME/.codex/gpt-image-2-skill/jobs" "$HOME/.local/share/gpt-image-2" "$HOME/.local/share/gpt-image-2-codex/gpt-image-2-skill"
    docker rm -f gpt-image-2-web-dev gpt-image-2-web-codex-smoke >/dev/null 2>&1 || true
    auth_mount=(); if [ -f "$HOME/.codex/auth.json" ]; then auth_mount=(-v "$HOME/.codex/auth.json:/data/codex/auth.json:ro"); fi; docker run -d --name gpt-image-2-web-dev -p 8787:8787 -v "$HOME/.local/share/gpt-image-2:/data/gpt-image-2" -v "$HOME/.local/share/gpt-image-2-codex:/data/codex" -v "$HOME/.codex/gpt-image-2-skill/jobs:/data/codex/gpt-image-2-skill/jobs:ro" "${auth_mount[@]}" "{{ image }}"

# Start the Tauri dev server for desktop-only behavior checks.
dev-tauri:
    cd apps/gpt-image-2-app && npm run tauri -- dev

# Run local release preparation gates.
release-prepare:
    scripts/release/prepare.sh

# Run local release verification gates.
release-verify:
    scripts/release/verify.sh

# Verify release assets downloaded into a directory.
release-verify-assets release_dir:
    scripts/release/verify.sh --release-dir "{{ release_dir }}"

# Dry-run a Cargo release version bump.
release-dry level="patch":
    scripts/release/publish.sh "{{ level }}"

# Execute a Cargo release version bump and publish.
release level="patch":
    scripts/release/publish.sh "{{ level }}" --execute

# Build and publish desktop app installers for an existing release tag.
release-tauri tag:
    gh workflow run "Tauri App Release" -f release_tag="{{ tag }}" -f release_draft=false -f prerelease=false

# Watch a GitHub Actions run until completion.
watch run_id:
    gh run watch "{{ run_id }}" --exit-status

# Check the public release surfaces for a tag.
release-status tag:
    gh release view "{{ tag }}" --json tagName,isDraft,isPrerelease,publishedAt,url,assets --jq '{tagName,isDraft,isPrerelease,publishedAt,url,assetCount:(.assets|length)}'
    npm view gpt-image-2-skill version dist-tags.latest --json
    cargo search gpt-image-2-skill --limit 1
    cargo search gpt-image-2-core --limit 1
    cargo search gpt-image-2-web --limit 1
