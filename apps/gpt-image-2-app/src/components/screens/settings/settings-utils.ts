import {
  defaultNotificationConfig,
  defaultStorageConfig,
  normalizeNotificationConfig,
  normalizePathConfig,
  normalizeStorageConfig,
  storageTargetType,
} from "@/lib/api/shared";
import type {
  CredentialRef,
  HttpStorageTargetConfig,
  NotificationConfig,
  PathConfig,
  BaiduNetdiskStorageTargetConfig,
  Pan123OpenStorageTargetConfig,
  SftpStorageTargetConfig,
  StorageConfig,
  StorageTargetConfig,
  StorageTargetKind,
  WebDavStorageTargetConfig,
  WebhookNotificationConfig,
} from "@/lib/types";
import { STORAGE_TARGET_TYPE_OPTIONS } from "./constants";

export function cloneNotificationConfig(value?: NotificationConfig) {
  return normalizeNotificationConfig(
    value
      ? (JSON.parse(JSON.stringify(value)) as NotificationConfig)
      : defaultNotificationConfig(),
  );
}

export function fileCredentialValue(credential?: CredentialRef | null) {
  return credential?.source === "file" && typeof credential.value === "string"
    ? credential.value
    : "";
}

// Keep in sync with `KEYCHAIN_SERVICE` in crates/gpt-image-2-core/src/lib.rs;
// the backend resolves keychain refs against this exact service name.
export const DEFAULT_KEYCHAIN_SERVICE = "gpt-image-2-skill";

export function blankCredential(
  source: CredentialRef["source"],
  previous?: CredentialRef | null,
): CredentialRef {
  if (source === "env") {
    return { source, env: previous?.source === "env" ? previous.env : "" };
  }
  if (source === "keychain") {
    return {
      source,
      service:
        previous?.source === "keychain"
          ? previous.service
          : DEFAULT_KEYCHAIN_SERVICE,
      account: previous?.source === "keychain" ? previous.account : "",
    };
  }
  return { source: "file", value: "" };
}

export function normalizeCredentialForSave(credential?: CredentialRef | null) {
  if (!credential) return null;
  if (credential.source === "env") {
    const env = credential.env?.trim();
    return env ? { source: "env" as const, env } : null;
  }
  if (credential.source === "keychain") {
    const account = credential.account?.trim();
    if (!account) return null;
    const service = credential.service?.trim();
    return {
      source: "keychain" as const,
      service: service || undefined,
      account,
    };
  }
  return {
    source: "file" as const,
    value: typeof credential.value === "string" ? credential.value : "",
  };
}

export function parseRecipients(value: string) {
  return value
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function webhookHeaderEntries(webhook: WebhookNotificationConfig) {
  return Object.entries(webhook.headers ?? {});
}

export function prepareNotificationConfigForSave(
  config: NotificationConfig,
): NotificationConfig {
  const webhookHeaders = (webhook: WebhookNotificationConfig) => {
    const headers: Record<string, CredentialRef> = {};
    for (const [header, credential] of webhookHeaderEntries(webhook)) {
      const name = header.trim();
      const nextCredential = normalizeCredentialForSave(credential);
      if (name && nextCredential) headers[name] = nextCredential;
    }
    return headers;
  };

  return {
    ...config,
    email: {
      ...config.email,
      smtp_host: config.email.smtp_host.trim(),
      smtp_port: Math.max(1, Math.round(config.email.smtp_port || 587)),
      username: config.email.username?.trim() || undefined,
      password: normalizeCredentialForSave(config.email.password),
      from: config.email.from.trim(),
      to: config.email.to.map((item) => item.trim()).filter(Boolean),
      timeout_seconds: Math.max(
        1,
        Math.round(config.email.timeout_seconds || 10),
      ),
    },
    webhooks: config.webhooks.map((webhook) => ({
      ...webhook,
      name: webhook.name.trim(),
      url: webhook.url.trim(),
      method: webhook.method.trim().toUpperCase() || "POST",
      timeout_seconds: Math.max(1, Math.round(webhook.timeout_seconds || 10)),
      headers: webhookHeaders(webhook),
    })),
  };
}

export function cloneStorageConfig(value?: StorageConfig) {
  return normalizeStorageConfig(
    value
      ? (JSON.parse(JSON.stringify(value)) as StorageConfig)
      : defaultStorageConfig(),
  );
}

export function clonePathConfig(value?: PathConfig) {
  return {
    ...normalizePathConfig(
      value
        ? (JSON.parse(JSON.stringify(value)) as PathConfig)
        : undefined,
    ),
  };
}

export function preparePathConfigForSave(config: PathConfig): PathConfig {
  return {
    ...config,
    app_data_dir: {
      mode: config.app_data_dir.mode,
      path:
        config.app_data_dir.mode === "custom"
          ? config.app_data_dir.path?.trim() || null
          : null,
    },
    result_library_dir: {
      mode: config.result_library_dir.mode,
      path:
        config.result_library_dir.mode === "custom"
          ? config.result_library_dir.path?.trim() || null
          : null,
    },
    default_export_dir: {
      mode: config.default_export_dir.mode,
      path:
        config.default_export_dir.mode === "custom"
          ? config.default_export_dir.path?.trim() || null
          : null,
    },
    legacy_shared_codex_dir: {
      ...config.legacy_shared_codex_dir,
      path: config.legacy_shared_codex_dir.path.trim(),
    },
  };
}

export function storageTargetLabel(target: StorageTargetConfig) {
  const type = storageTargetType(target);
  return (
    STORAGE_TARGET_TYPE_OPTIONS.find((option) => option.value === type)
      ?.label ?? type
  );
}

export function blankStorageTarget(type: StorageTargetKind): StorageTargetConfig {
  if (type === "s3") {
    return {
      type,
      bucket: "",
      region: "",
      endpoint: "",
      prefix: "",
      access_key_id: null,
      secret_access_key: null,
      session_token: null,
      public_base_url: "",
    };
  }
  if (type === "webdav") {
    return {
      type,
      url: "",
      username: "",
      password: null,
      public_base_url: "",
    };
  }
  if (type === "http") {
    return {
      type,
      url: "",
      method: "POST",
      headers: {},
      public_url_json_pointer: "",
    };
  }
  if (type === "sftp") {
    return {
      type,
      host: "",
      port: 22,
      host_key_sha256: "",
      username: "",
      password: null,
      private_key: null,
      remote_dir: "/",
      public_base_url: "",
    };
  }
  if (type === "baidu_netdisk") {
    return {
      type,
      auth_mode: "personal",
      app_key: "",
      secret_key: null,
      access_token: null,
      refresh_token: null,
      app_name: "",
      remote_dir: "",
      public_base_url: "",
    };
  }
  if (type === "pan123_open") {
    return {
      type,
      auth_mode: "client",
      client_id: "",
      client_secret: null,
      access_token: null,
      parent_id: 0,
      use_direct_link: false,
    };
  }
  return { type: "local", directory: "", public_base_url: "" };
}

export function normalizeStorageTargetForSave(
  target: StorageTargetConfig,
): StorageTargetConfig {
  const type = storageTargetType(target);
  if (type === "s3" && "bucket" in target) {
    return {
      type,
      bucket: target.bucket.trim(),
      region: target.region?.trim() || undefined,
      endpoint: target.endpoint?.trim() || undefined,
      prefix: target.prefix?.trim() || undefined,
      access_key_id: normalizeCredentialForSave(target.access_key_id),
      secret_access_key: normalizeCredentialForSave(target.secret_access_key),
      session_token: normalizeCredentialForSave(target.session_token),
      public_base_url: target.public_base_url?.trim() || undefined,
    };
  }
  if (type === "webdav") {
    const webdav = target as WebDavStorageTargetConfig;
    return {
      type,
      url: webdav.url.trim(),
      username: webdav.username?.trim() || undefined,
      password: normalizeCredentialForSave(webdav.password),
      public_base_url: webdav.public_base_url?.trim() || undefined,
    };
  }
  if (type === "http") {
    const http = target as HttpStorageTargetConfig;
    const headers: Record<string, CredentialRef> = {};
    for (const [header, credential] of Object.entries(http.headers ?? {})) {
      const key = header.trim();
      const nextCredential = normalizeCredentialForSave(credential);
      if (key && nextCredential) headers[key] = nextCredential;
    }
    return {
      type,
      url: http.url.trim(),
      method: http.method.trim().toUpperCase() || "POST",
      headers,
      public_url_json_pointer:
        http.public_url_json_pointer?.trim() || undefined,
    };
  }
  if (type === "sftp") {
    const sftp = target as SftpStorageTargetConfig;
    return {
      type,
      host: sftp.host.trim(),
      port: Math.max(1, Math.round(sftp.port || 22)),
      host_key_sha256: sftp.host_key_sha256?.trim() || undefined,
      username: sftp.username.trim(),
      password: normalizeCredentialForSave(sftp.password),
      private_key: normalizeCredentialForSave(sftp.private_key),
      remote_dir: sftp.remote_dir.trim() || "/",
      public_base_url: sftp.public_base_url?.trim() || undefined,
    };
  }
  if (type === "baidu_netdisk") {
    const baidu = target as BaiduNetdiskStorageTargetConfig;
    const authMode = baidu.auth_mode === "oauth" ? "oauth" : "personal";
    return {
      type,
      auth_mode: authMode,
      app_key: authMode === "oauth" ? baidu.app_key.trim() : "",
      secret_key:
        authMode === "oauth"
          ? normalizeCredentialForSave(baidu.secret_key)
          : undefined,
      access_token:
        authMode === "personal"
          ? normalizeCredentialForSave(baidu.access_token)
          : undefined,
      refresh_token:
        authMode === "oauth"
          ? normalizeCredentialForSave(baidu.refresh_token)
          : undefined,
      app_name: baidu.app_name.trim(),
      remote_dir: baidu.remote_dir?.trim() || undefined,
      public_base_url: baidu.public_base_url?.trim() || undefined,
    };
  }
  if (type === "pan123_open") {
    const pan123 = target as Pan123OpenStorageTargetConfig;
    const authMode =
      pan123.auth_mode === "access_token" ? "access_token" : "client";
    return {
      type,
      auth_mode: authMode,
      client_id: authMode === "client" ? pan123.client_id.trim() : "",
      client_secret:
        authMode === "client"
          ? normalizeCredentialForSave(pan123.client_secret)
          : undefined,
      access_token:
        authMode === "access_token"
          ? normalizeCredentialForSave(pan123.access_token)
          : undefined,
      parent_id: Math.max(0, Math.round(pan123.parent_id || 0)),
      use_direct_link: Boolean(pan123.use_direct_link),
    };
  }
  return {
    type: "local",
    directory: "directory" in target ? target.directory.trim() : "",
    public_base_url:
      "public_base_url" in target
        ? target.public_base_url?.trim() || undefined
        : undefined,
  };
}

export function prepareStorageConfigForSave(config: StorageConfig): StorageConfig {
  const renamedTargets = Object.fromEntries(
    Object.entries(config.targets)
      .map(([name, target]) => [
        name.trim(),
        normalizeStorageTargetForSave(target),
      ])
      .filter(([name]) => name),
  );
  const nameMap = new Map(
    Object.keys(config.targets).map((name) => [name, name.trim()]),
  );
  const validNames = new Set(Object.keys(renamedTargets));
  const normalizeTargetNames = (names: string[]) =>
    names
      .map((name) => nameMap.get(name) ?? name.trim())
      .filter((name): name is string => Boolean(name) && validNames.has(name));
  return {
    targets: renamedTargets,
    default_targets: normalizeTargetNames(config.default_targets),
    fallback_targets: normalizeTargetNames(config.fallback_targets),
    fallback_policy: config.fallback_policy,
    upload_concurrency: Math.max(
      1,
      Math.round(config.upload_concurrency || 4),
    ),
    target_concurrency: Math.max(
      1,
      Math.round(config.target_concurrency || 2),
    ),
  };
}
