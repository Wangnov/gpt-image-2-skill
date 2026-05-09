FROM node:22-bookworm AS web
WORKDIR /app
COPY apps/gpt-image-2-app/package.json apps/gpt-image-2-app/package-lock.json ./apps/gpt-image-2-app/
RUN npm --prefix apps/gpt-image-2-app ci
COPY apps/gpt-image-2-app ./apps/gpt-image-2-app
RUN npm --prefix apps/gpt-image-2-app run build:http

FROM rust:1-bookworm AS rust-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY apps/gpt-image-2-app/src-tauri ./apps/gpt-image-2-app/src-tauri
RUN cargo build --release -p gpt-image-2-web

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=rust-builder /app/target/release/gpt-image-2-web /usr/local/bin/gpt-image-2-web
COPY --from=web /app/apps/gpt-image-2-app/dist /app/public
ENV GPT_IMAGE_2_WEB_HOST=0.0.0.0 \
    GPT_IMAGE_2_WEB_PORT=8787 \
    GPT_IMAGE_2_WEB_DIST=/app/public \
    GPT_IMAGE_2_DATA_DIR=/data/gpt-image-2 \
    GPT_IMAGE_2_ALLOWED_DATA_ROOTS=/data/gpt-image-2 \
    XDG_CONFIG_HOME=/data/config \
    CODEX_HOME=/data/codex
VOLUME ["/data"]
EXPOSE 8787
CMD ["gpt-image-2-web"]
