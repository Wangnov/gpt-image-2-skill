# Docker Web

Docker Web 是第二种自托管运行时：同一套 React UI 以 HTTP transport 连接容器内的 `gpt-image-2-web` 服务端。服务端复用 Rust core、共享配置和 SQLite 历史；新的生成结果写入产品结果库 `/data/gpt-image-2/jobs`，旧的 `$CODEX_HOME/gpt-image-2-skill/jobs` 仅作为兼容读取目录。

## Pull

```bash
docker pull ghcr.io/wangnov/gpt-image-2:latest
```

Release images are also tagged by version:

```bash
docker pull ghcr.io/wangnov/gpt-image-2:0.6.1
```

## Build Locally

```bash
docker build -t gpt-image-2-web .
```

## Access control

The container binds `0.0.0.0`, so the API — including the endpoint that reads
back stored provider keys — is reachable by anything that can reach the port.
The server therefore **refuses to start on a non-loopback host unless
`GPT_IMAGE_2_WEB_TOKEN` is set**. Set it to a secret and the whole `/api`
surface requires that token (sent as `Authorization: Bearer <token>` or, for
the web UI, exchanged for an HttpOnly session cookie at first load):

```bash
-e GPT_IMAGE_2_WEB_TOKEN="$(openssl rand -hex 32)"
```

To run without a token, bind loopback only (`-e GPT_IMAGE_2_WEB_HOST=127.0.0.1`
and publish to `127.0.0.1:8787:8787`); token-less mode also rejects requests
whose `Host` header isn't a loopback name (override with
`GPT_IMAGE_2_WEB_ALLOWED_HOSTS`). If the port is only reachable on a trusted
network (e.g. a container published to `127.0.0.1` or fronted by a
reverse proxy that authenticates), set `GPT_IMAGE_2_WEB_ALLOW_UNAUTHENTICATED=1`
to permit token-less `0.0.0.0` binding — it prints a warning and leaves the
API open, so only use it when the network already restricts access.

## Run

OpenAI-compatible API Key (exposed on the LAN, so a token is required):

```bash
docker run --rm -p 8787:8787 \
  -v gpt-image-2-data:/data \
  -e OPENAI_API_KEY=sk-... \
  -e GPT_IMAGE_2_WEB_TOKEN="$(openssl rand -hex 32)" \
  ghcr.io/wangnov/gpt-image-2:latest
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
  ghcr.io/wangnov/gpt-image-2:latest
```

The project shortcut is `just dev-http-backend`; it creates the local product data directory, restarts the detached `gpt-image-2-web-dev` container, mounts `~/.local/share/gpt-image-2` read-write for new results, mounts `~/.local/share/gpt-image-2-codex` read-write for Docker Web config/history, mounts the old `~/.codex/gpt-image-2-skill/jobs` directory read-only for legacy outputs, and mounts `~/.codex/auth.json` read-only when it exists.

Open [http://localhost:8787](http://localhost:8787). The browser talks to `/api`, while image files are served only from the server-side result library or the read-only legacy jobs directory.

## Storage Policy Templates

Managed deployments can commit a config template with `storage.policy.managed = true` and `allow_user_overrides = true` to provide administrator defaults without locking the user out. The UI shows `管理员默认值`; save paths preserve the policy, but the user's current Origin / Archive / mode choices remain editable. Only set `allow_user_overrides = false` for a genuinely locked deployment.

Deleting local history/cache in Docker Web or Desktop only removes local records and files; uploaded Origin/Archive objects are intentionally left intact.

Small-team local library, with optional local archive:

```json
{
  "storage": {
    "targets": {
      "team-nas": { "type": "local", "directory": "/data/gpt-image-2/jobs" },
      "audit-copy": { "type": "local", "directory": "/data/gpt-image-2/archive" }
    },
    "pipeline": {
      "mode": "mirror",
      "origin": null,
      "archives": ["audit-copy"],
      "cleanup": { "mode": "never" }
    },
    "policy": {
      "managed": true,
      "allow_user_overrides": true,
      "message": "Small-team install: local result library stays authoritative."
    }
  }
}
```

Enterprise cloud-primary library:

```json
{
  "storage": {
    "targets": {
      "r2-origin": {
        "type": "s3",
        "bucket": "gpt-image-2-prod",
        "endpoint": "https://<account-id>.r2.cloudflarestorage.com",
        "prefix": "outputs/",
        "access_key_id": { "source": "env", "env": "R2_ACCESS_KEY_ID" },
        "secret_access_key": { "source": "env", "env": "R2_SECRET_ACCESS_KEY" }
      },
      "audit-webhook": { "type": "http", "url": "https://audit.example.com/storage" }
    },
    "pipeline": {
      "mode": "cloud_primary",
      "origin": "r2-origin",
      "archives": ["audit-webhook"],
      "cleanup": { "mode": "after_archive_success" }
    },
    "policy": {
      "managed": true,
      "allow_user_overrides": true,
      "message": "Enterprise install: R2 is the authoritative result Origin."
    }
  }
}
```

Webhook audit archive, while local results remain Origin:

```json
{
  "storage": {
    "targets": {
      "audit-webhook": {
        "type": "http",
        "url": "https://audit.example.com/gpt-image-2",
        "headers": {
          "Authorization": { "source": "env", "env": "AUDIT_WEBHOOK_AUTH" }
        }
      }
    },
    "pipeline": {
      "mode": "cloud_archive_only",
      "origin": null,
      "archives": ["audit-webhook"],
      "cleanup": { "mode": "never" }
    },
    "policy": {
      "managed": true,
      "allow_user_overrides": true,
      "message": "Audit install: every output is pushed to the webhook archive."
    }
  }
}
```

## Local Smoke

```bash
npm --prefix apps/gpt-image-2-app run build:http
cargo run -p gpt-image-2-web -- --host 127.0.0.1 --port 8787 --static-dir apps/gpt-image-2-app/dist
curl http://127.0.0.1:8787/api/config
```
