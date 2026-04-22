# Rust Release And Distribution Design

## Decision

This project will ship as a Rust-first CLI with one canonical binary name:

- binary: `gpt-image-2-skill`
- crates.io package: `gpt-image-2-skill`
- GitHub repo: `Wangnov/gpt-image-2-skill`
- Homebrew formula: `wangnov/tap/gpt-image-2-skill`

The release system will use:

- `cargo release` for version bumps, release commits, tags, and crates.io publishing
- `cargo-dist` for GitHub Release assets, shell installer, PowerShell installer, Homebrew formula publishing, and MSI generation
- a custom npm workflow for root package + platform package matrix publishing

The Python CLI stays in the repo as a reference implementation during migration. The Rust CLI becomes the public distribution surface.

## CLI Classification

### Product CLI

- purpose: generate and edit images through OpenAI API keys or Codex auth with a stable machine-readable CLI
- primary role: Capability CLI
- primary user: balanced human + agent
- primary interaction: non-interactive command execution
- statefulness: mostly stateless, with durable auth/config side effects
- risk profile:
  - low: `doctor`, `auth inspect`, `models list`
  - medium: `images generate`, `images edit`, `request create`
- primary machine surface:
  - stdout JSON envelope
  - stderr JSONL progress events
- secondary surfaces:
  - bundled Skill wrapper
  - raw request escape hatch
  - package-manager installs

### Release System

- purpose: cut one version and fan it out consistently to crates.io, GitHub Releases, Homebrew, shell installers, PowerShell installers, MSI, and npm packages
- primary role: Workflow / Package-Build
- primary user: maintainer
- primary interaction: scripted release steps and GitHub Actions jobs
- statefulness: tag- and version-driven, with registry side effects

## Repository Shape

Use a virtual Cargo workspace at repo root. This fits the current mixed-language repo and gives clean space for Rust, npm, and legacy Python.

```text
Cargo.toml
dist-workspace.toml
crates/gpt-image-2-skill/
  Cargo.toml
  src/main.rs
  src/...

packages/npm/gpt-image-2-skill/
packages/npm/gpt-image-2-skill-darwin-arm64/
packages/npm/gpt-image-2-skill-darwin-x64/
packages/npm/gpt-image-2-skill-linux-arm64-gnu/
packages/npm/gpt-image-2-skill-linux-x64-gnu/
packages/npm/gpt-image-2-skill-linux-x64-musl/
packages/npm/gpt-image-2-skill-windows-arm64-msvc/
packages/npm/gpt-image-2-skill-windows-x64-msvc/

scripts/release/prepare.sh
scripts/release/publish.sh
scripts/release/verify.sh
scripts/release/smoke-archive.sh
scripts/npm/build-matrix.mjs

.github/workflows/release.yml
.github/workflows/release-candidate.yml
.github/workflows/npm-publish.yml
.github/workflows/post-release-verify.yml

skills/gpt-image-2-skill/
```

## Cargo Workspace Design

### Root `Cargo.toml`

The root manifest should be virtual and hold unified release metadata:

```toml
[workspace]
members = ["crates/gpt-image-2-skill"]
resolver = "2"

[workspace.metadata.release]
shared-version = true
tag-name = "v{{version}}"
push = false
publish = false
```

### CLI crate

The Rust crate should keep the external name stable:

```toml
[package]
name = "gpt-image-2-skill"
version = "0.3.0"
edition = "2024"
description = "Agent-first GPT Image 2 CLI and installable skill runtime."
license = "MIT"
repository = "https://github.com/Wangnov/gpt-image-2-skill"
homepage = "https://github.com/Wangnov/gpt-image-2-skill"
documentation = "https://github.com/Wangnov/gpt-image-2-skill#readme"
authors = ["Wangnov <48670012+Wangnov@users.noreply.github.com>"]

[[bin]]
name = "gpt-image-2-skill"
path = "src/main.rs"
```

### Binstall metadata

Add explicit binstall metadata so `cargo binstall gpt-image-2-skill` resolves GitHub Release assets deterministically:

```toml
[package.metadata.binstall]
pkg-url = "{ repo }/releases/download/v{ version }/{ name }-{ target }{ archive-suffix }"
bin-dir = "{ bin }{ binary-ext }"
pkg-fmt = "auto"
```

This keeps `cargo install` and `cargo binstall` aligned:

- `cargo install gpt-image-2-skill --locked`
- `cargo binstall gpt-image-2-skill`

## Command Contract

The Rust CLI keeps the current Python command surface:

```text
gpt-image-2-skill --json doctor
gpt-image-2-skill --json auth inspect
gpt-image-2-skill --json models list
gpt-image-2-skill --json images generate ...
gpt-image-2-skill --json images edit ...
gpt-image-2-skill --json request create ...
```

Compatibility rules:

- stdout keeps the current JSON envelope
- stderr keeps `--json-events` JSONL progress
- flags stay stable across the migration
- exit codes stay stable
- the bundled Skill calls the binary once it exists

## Target Matrix

### Release archive targets

V1 target set:

- `x86_64-unknown-linux-gnu`
- `x86_64-unknown-linux-musl`
- `aarch64-unknown-linux-gnu`
- `x86_64-apple-darwin`
- `aarch64-apple-darwin`
- `x86_64-pc-windows-msvc`
- `aarch64-pc-windows-msvc`

This set covers:

- `cargo binstall` on mainstream desktop/server targets
- Homebrew on Apple Silicon and Intel Macs
- shell and PowerShell installers
- npm platform packages for macOS, Linux, and Windows

### GitHub Actions runners

Pin current public-runner labels:

- `ubuntu-24.04` for `x86_64-unknown-linux-*`
- `ubuntu-24.04-arm` for `aarch64-unknown-linux-*`
- `macos-15-intel` for `x86_64-apple-darwin`
- `macos-15` for `aarch64-apple-darwin`
- `windows-2025` for `x86_64-pc-windows-msvc`
- `windows-11-arm` for `aarch64-pc-windows-msvc`

## `cargo-dist` Design

Use `cargo-dist` for release assets and native installers. Keep npm matrix publishing separate.

```toml
[dist]
cargo-dist-version = "0.31.0"
ci = ["github"]
hosting = ["github"]
targets = [
  "x86_64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-gnu",
  "x86_64-apple-darwin",
  "aarch64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "aarch64-pc-windows-msvc",
]
installers = ["shell", "powershell", "homebrew", "msi"]
tap = "Wangnov/homebrew-tap"
publish-jobs = ["homebrew"]
install-path = "CARGO_HOME"
install-success-msg = "gpt-image-2-skill is ready."

[dist.github-custom-runners]
aarch64-pc-windows-msvc = "windows-11-arm"
```

Design choices:

- `npm` stays out of `installers`
- shell + PowerShell installers come from `cargo-dist`
- GitHub Release stays the source of truth for prebuilt archives
- Homebrew publishes into the existing `Wangnov/homebrew-tap` repository
- MSI ships for Windows GUI-style installation

## npm Matrix Design

### Package naming

Recommended naming:

- root package: `@wangnov/gpt-image-2-skill`
- platform packages:
  - `@wangnov/gpt-image-2-skill-darwin-arm64`
  - `@wangnov/gpt-image-2-skill-darwin-x64`
  - `@wangnov/gpt-image-2-skill-linux-arm64-gnu`
  - `@wangnov/gpt-image-2-skill-linux-x64-gnu`
  - `@wangnov/gpt-image-2-skill-linux-x64-musl`
  - `@wangnov/gpt-image-2-skill-windows-arm64-msvc`
  - `@wangnov/gpt-image-2-skill-windows-x64-msvc`

The suffix map should stay stable even if the final npm scope changes.

### Package behavior

Root package responsibilities:

- expose the `gpt-image-2-skill` command in `bin`
- select the correct platform package through `optionalDependencies`
- hand off execution to the unpacked native binary

Platform package responsibilities:

- carry exactly one prebuilt binary for one target
- declare `os`, `cpu`, and `libc` constraints
- ship a tiny JS shim that returns the embedded binary path

### Publish order

- publish all platform packages first
- publish root package second
- keep one version across root and platform packages

### Trusted publishing

Use one dedicated workflow file name and keep it stable:

- workflow: `.github/workflows/npm-publish.yml`

Grant:

- `contents: read`
- `id-token: write`

Configure trusted publishing for every npm package:

- one record for the root package
- one record per platform package

Bootstrap flow:

- first publish uses `NPM_TOKEN` from GitHub Actions secrets together with `npm publish --provenance`
- after all packages exist on npm, run `scripts/release/configure-npm-trust.sh`
- the trust step uses the workflow file name `npm-publish.yml`
- npm trust setup needs an npm account session with account-level 2FA enabled

## Release Scripts

Use a two-phase release flow.

### `scripts/release/prepare.sh`

Purpose:

- bump version locally
- create the release commit
- keep tag and push for phase two

Command:

```bash
#!/usr/bin/env bash
set -euo pipefail

level="${1:?patch|minor|major|<version>}"
cargo release "$level" --workspace --execute --no-publish --no-tag --no-push --no-confirm
git push origin main
```

### `scripts/release/publish.sh`

Purpose:

- publish to crates.io
- create `vX.Y.Z`
- push the tag and trigger `cargo-dist`

Command:

```bash
#!/usr/bin/env bash
set -euo pipefail

cargo release publish --workspace --execute --no-confirm
cargo release tag --workspace --execute --no-confirm
cargo release push --workspace --execute --no-confirm
```

### `scripts/release/verify.sh`

Purpose:

- verify GitHub Release assets
- verify crates.io version
- verify npm package versions
- verify brew formula update

### `scripts/release/smoke-archive.sh`

Purpose:

- download one release archive
- run `--json doctor`
- run one read-only smoke command

## GitHub Actions Design

### `.github/workflows/release.yml`

Generated and owned by `cargo-dist`.

Responsibilities:

- plan
- build archives and installers
- create GitHub Release
- upload artifacts
- publish Homebrew formula

### `.github/workflows/release-candidate.yml`

Hand-written maintainer workflow.

Responsibilities:

- trigger manually on `workflow_dispatch`
- download candidate artifacts from the current commit
- run smoke tests on Linux, macOS, and Windows
- fail fast on broken installer or CLI startup

### `.github/workflows/npm-publish.yml`

Hand-written publish workflow.

Responsibilities:

- trigger after the GitHub Release is available
- download release assets
- build platform npm packages
- publish platform packages
- publish root package

### `.github/workflows/post-release-verify.yml`

Hand-written verification workflow.

Responsibilities:

- confirm GitHub Release exists
- confirm crates.io index sees the new version
- confirm npm root/platform packages expose the same version
- confirm Homebrew tap received the formula update

## Homebrew Design

Use the existing public tap:

- repository: `Wangnov/homebrew-tap`
- install command: `brew install wangnov/tap/gpt-image-2-skill`

Release requirements:

- `description` and `homepage` stay populated in Cargo metadata
- repository URL stays stable
- `HOMEBREW_TAP_TOKEN` is configured in the main repo secrets

## V1 Boundary

V1 includes:

- Rust CLI with command-line parity for the current Python surface
- crates.io publishing
- `cargo binstall` via GitHub Release assets
- shell installer
- PowerShell installer
- Homebrew publishing
- Windows MSI
- npm root + platform matrix
- release candidate workflow
- post-release verification

V1.1 includes:

- updater binary from `cargo-dist`
- GitHub attestations
- Windows code signing
- simple static mirror hosting in front of GitHub Releases

## Implementation Order

1. add the Rust workspace and CLI crate
2. port `doctor`, `auth inspect`, `models list`
3. port `images generate`, `images edit`, `request create`
4. add `cargo release` metadata
5. add `cargo-dist` config and generated release workflow
6. add release scripts
7. add release candidate smoke workflow
8. add npm package templates and publish workflow
9. add post-release verification workflow
10. switch the Skill to call the Rust binary

## Current External Constraints

- crates.io search does not currently show an existing `gpt-image-2-skill` crate
- npm registry currently returns `404` for `gpt-image-2-skill`
- npm registry currently returns `404` for `@wangnov/gpt-image-2-skill`
- `Wangnov/homebrew-tap` already exists and is public

## Source Notes

- GitHub runner labels and current public-runner matrix: https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job
- npm trusted publishing and OIDC workflow constraints: https://docs.npmjs.com/trusted-publishers/
- `cargo-dist` installer matrix and generated GitHub Release pipeline: https://axodotdev.github.io/cargo-dist/
- `cargo-dist` install methods: https://axodotdev.github.io/cargo-dist/book/install.html
- `cargo-dist` config reference: https://axodotdev.github.io/cargo-dist/book/reference/config.html
- `cargo-dist` Homebrew guidance: https://axodotdev.github.io/cargo-dist/book/installers/homebrew.html
- `cargo-dist` MSI guidance: https://axodotdev.github.io/cargo-dist/book/installers/msi.html
- `cargo-dist` guidance for `cargo release`: https://axodotdev.github.io/cargo-dist/book/workspaces/cargo-release-guide.html
- `cargo-binstall` maintainer guidance for explicit metadata: https://github.com/cargo-bins/cargo-binstall
