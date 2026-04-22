install-local:
	cargo install --path crates/gpt-image-2-skill --locked --force

sync-skill:
	node scripts/sync_skill_bundle.cjs

smoke-skill-install:
	node scripts/smoke_skill_install.cjs

test:
	cargo test -p gpt-image-2-skill

build:
	cargo build -p gpt-image-2-skill

build-release:
	cargo build --release -p gpt-image-2-skill

npm-matrix:
	node scripts/npm/build-matrix.mjs

release-prepare:
	scripts/release/prepare.sh
