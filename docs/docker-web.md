# Docker Web

Docker Web 是第二种自托管运行时：同一套 React UI 以 HTTP transport 连接容器内的 `gpt-image-2-web` 服务端。服务端复用 Rust core、共享配置、SQLite 历史和本地 jobs 目录，因此可以使用 `env`、`file` provider，也可以在挂载 `CODEX_HOME` 后使用 Codex provider。

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

Codex auth mounted from the host:

```bash
docker run --rm -p 8787:8787 \
  -v gpt-image-2-data:/data \
  -v "$HOME/.codex:/data/codex:ro" \
  gpt-image-2-web
```

Open [http://localhost:8787](http://localhost:8787). The browser talks to `/api`, while image files are served only from the server-side jobs directory.

## Local Smoke

```bash
npm --prefix apps/gpt-image-2-app run build:http
cargo run -p gpt-image-2-web -- --host 127.0.0.1 --port 8787 --static-dir apps/gpt-image-2-app/dist
curl http://127.0.0.1:8787/api/config
```
