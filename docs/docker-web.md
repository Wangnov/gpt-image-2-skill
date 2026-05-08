# Docker Web

Docker Web 是第二种自托管运行时：同一套 React UI 以 HTTP transport 连接容器内的 `gpt-image-2-web` 服务端。服务端复用 Rust core、共享配置和 SQLite 历史；新的生成结果写入产品结果库 `/data/gpt-image-2/jobs`，旧的 `$CODEX_HOME/gpt-image-2-skill/jobs` 仅作为兼容读取目录。

## Build

```bash
docker build -t gpt-image-2-web .
```

## Run

OpenAI-compatible API Key:

```bash
docker run --rm -p 8787:8787 \
  -v gpt-image-2-data:/data \
  -e OPENAI_API_KEY=sk-... \
  gpt-image-2-web
```

Development mode with writable Docker Web config/history plus read-only legacy jobs:

```bash
mkdir -p "$HOME/.local/share/gpt-image-2" \
  "$HOME/.local/share/gpt-image-2-codex/gpt-image-2-skill" \
  "$HOME/.codex/gpt-image-2-skill/jobs"
docker run --rm -p 8787:8787 \
  -v "$HOME/.local/share/gpt-image-2:/data/gpt-image-2" \
  -v "$HOME/.local/share/gpt-image-2-codex:/data/codex" \
  -v "$HOME/.codex/gpt-image-2-skill/jobs:/data/codex/gpt-image-2-skill/jobs:ro" \
  -v "$HOME/.codex/auth.json:/data/codex/auth.json:ro" \
  gpt-image-2-web
```

The project shortcut is `just dev-http-backend`; it creates the local product data directory, restarts the detached `gpt-image-2-web-dev` container, mounts `~/.local/share/gpt-image-2` read-write for new results, mounts `~/.local/share/gpt-image-2-codex` read-write for Docker Web config/history, mounts the old `~/.codex/gpt-image-2-skill/jobs` directory read-only for legacy outputs, and mounts `~/.codex/auth.json` read-only when it exists.

Open [http://localhost:8787](http://localhost:8787). The browser talks to `/api`, while image files are served only from the server-side result library or the read-only legacy jobs directory.

## Local Smoke

```bash
npm --prefix apps/gpt-image-2-app run build:http
cargo run -p gpt-image-2-web -- --host 127.0.0.1 --port 8787 --static-dir apps/gpt-image-2-app/dist
curl http://127.0.0.1:8787/api/config
```
