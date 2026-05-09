import type { CredentialRef, NotificationConfig, ProviderConfig, ServerConfig, StorageConfig, StorageTargetConfig } from "../../types";
import { normalizeConfig, normalizeNotificationConfig, normalizePathConfig, normalizeStorageConfig, storageTargetType } from "../shared";
import { readConfigRecord } from "./store";

export function sanitizeCredential(credential: ProviderConfig["credentials"][string]) {
  if (credential.source === "file") {
    return {
      source: "file" as const,
      present: Boolean(
        credential.present ||
        (typeof credential.value === "string" && credential.value.length > 0),
      ),
    };
  }
  const { value: _value, ...rest } = credential;
  return rest;
}

// Replace any inline file secret with an empty value, keeping the source so
// the editor still renders the right input shape. env / keychain credentials
// hold only references, so they pass through unchanged.
export function scrubFileCredentialSecret<
  T extends NotificationConfig["email"]["password"],
>(credential: T): T {
  if (credential && credential.source === "file") {
    return { source: "file", value: "" } as unknown as T;
  }
  return credential;
}

export function scrubStorageCredential(credential?: CredentialRef | null) {
  return scrubFileCredentialSecret(credential ?? null);
}

export function scrubStorageTargetSecrets(
  target: StorageTargetConfig,
): StorageTargetConfig {
  const type = storageTargetType(target);
  if (type === "s3") {
    return {
      ...target,
      type,
      access_key_id:
        "access_key_id" in target
          ? scrubStorageCredential(target.access_key_id)
          : null,
      secret_access_key:
        "secret_access_key" in target
          ? scrubStorageCredential(target.secret_access_key)
          : null,
      session_token:
        "session_token" in target
          ? scrubStorageCredential(target.session_token)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "webdav") {
    return {
      ...target,
      type,
      password:
        "password" in target ? scrubStorageCredential(target.password) : null,
    } as StorageTargetConfig;
  }
  if (type === "http") {
    return {
      ...target,
      type,
      headers:
        "headers" in target
          ? Object.fromEntries(
              Object.entries(target.headers ?? {}).map(([name, credential]) => [
                name,
                scrubStorageCredential(credential)!,
              ]),
            )
          : {},
    } as StorageTargetConfig;
  }
  if (type === "sftp") {
    return {
      ...target,
      type,
      password:
        "password" in target ? scrubStorageCredential(target.password) : null,
      private_key:
        "private_key" in target
          ? scrubStorageCredential(target.private_key)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "baidu_netdisk") {
    return {
      ...target,
      type,
      secret_key:
        "secret_key" in target
          ? scrubStorageCredential(target.secret_key)
          : null,
      access_token:
        "access_token" in target
          ? scrubStorageCredential(target.access_token)
          : null,
      refresh_token:
        "refresh_token" in target
          ? scrubStorageCredential(target.refresh_token)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "pan123_open") {
    return {
      ...target,
      type,
      client_secret:
        "client_secret" in target
          ? scrubStorageCredential(target.client_secret)
          : null,
      access_token:
        "access_token" in target
          ? scrubStorageCredential(target.access_token)
          : null,
    } as StorageTargetConfig;
  }
  return { ...target, type: "local" } as StorageTargetConfig;
}

export function sanitizeStorageTargetConfig(
  target: StorageTargetConfig,
): StorageTargetConfig {
  const scrubbed = scrubStorageTargetSecrets(target);
  const type = storageTargetType(scrubbed);
  if (type === "s3") {
    return {
      ...scrubbed,
      access_key_id:
        "access_key_id" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.access_key_id)
          : null,
      secret_access_key:
        "secret_access_key" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.secret_access_key)
          : null,
      session_token:
        "session_token" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.session_token)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "webdav") {
    return {
      ...scrubbed,
      password:
        "password" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.password)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "http") {
    return {
      ...scrubbed,
      headers:
        "headers" in scrubbed
          ? Object.fromEntries(
              Object.entries(scrubbed.headers ?? {}).map(
                ([name, credential]) => [
                  name,
                  sanitizeNotificationCredential(credential)!,
                ],
              ),
            )
          : {},
    } as StorageTargetConfig;
  }
  if (type === "sftp") {
    return {
      ...scrubbed,
      password:
        "password" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.password)
          : null,
      private_key:
        "private_key" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.private_key)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "baidu_netdisk") {
    return {
      ...scrubbed,
      secret_key:
        "secret_key" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.secret_key)
          : null,
      access_token:
        "access_token" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.access_token)
          : null,
      refresh_token:
        "refresh_token" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.refresh_token)
          : null,
    } as StorageTargetConfig;
  }
  if (type === "pan123_open") {
    return {
      ...scrubbed,
      client_secret:
        "client_secret" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.client_secret)
          : null,
      access_token:
        "access_token" in scrubbed
          ? sanitizeNotificationCredential(scrubbed.access_token)
          : null,
    } as StorageTargetConfig;
  }
  return scrubbed;
}

export function sanitizeStorageConfig(config: StorageConfig): StorageConfig {
  const normalized = normalizeStorageConfig(config);
  const localTargetNames = new Set(
    Object.entries(normalized.targets)
      .filter(([, target]) => storageTargetType(target) === "local")
      .map(([name]) => name),
  );
  return {
    ...normalized,
    default_targets: normalized.default_targets.filter((name) =>
      localTargetNames.has(name),
    ),
    fallback_targets: normalized.fallback_targets.filter((name) =>
      localTargetNames.has(name),
    ),
    targets: Object.fromEntries(
      Object.entries(normalized.targets).map(([name, target]) => [
        name,
        sanitizeStorageTargetConfig(target),
      ]),
    ),
  };
}

export function sanitizeNotificationCredential(
  credential: NotificationConfig["email"]["password"],
) {
  if (!credential) return credential;
  if (credential.source === "file") {
    return {
      source: "file" as const,
      present: Boolean(
        credential.present ||
        (typeof credential.value === "string" && credential.value.length > 0),
      ),
    };
  }
  const { value: _value, ...rest } = credential;
  return rest;
}

export function sanitizeNotificationConfig(
  config: NotificationConfig,
): NotificationConfig {
  return {
    ...config,
    email: {
      ...config.email,
      password: sanitizeNotificationCredential(config.email.password),
    },
    webhooks: config.webhooks.map((webhook) => ({
      ...webhook,
      headers: Object.fromEntries(
        Object.entries(webhook.headers ?? {}).map(([header, credential]) => [
          header,
          sanitizeNotificationCredential(credential)!,
        ]),
      ),
    })),
  };
}

export function browserConfigForUi(config: ServerConfig): ServerConfig {
  const providers = Object.fromEntries(
    Object.entries(config.providers ?? {}).map(([name, provider]) => [
      name,
      {
        ...provider,
        credentials: Object.fromEntries(
          Object.entries(provider.credentials ?? {}).map(
            ([key, credential]) => [key, sanitizeCredential(credential)],
          ),
        ),
      },
    ]),
  );
  providers.codex = {
    type: "codex",
    model: "gpt-5.4",
    credentials: {},
    builtin: true,
    disabled: true,
    disabled_reason:
      "静态 Web 不能读取 Codex 登录态，请使用桌面 App 或 Docker。",
  };
  const defaultProvider =
    config.default_provider &&
    providers[config.default_provider]?.disabled !== true
      ? config.default_provider
      : Object.entries(providers).find(
          ([, provider]) => !provider.disabled,
        )?.[0];
  return normalizeConfig({
    version: 1,
    default_provider: defaultProvider,
    providers,
    notifications: sanitizeNotificationConfig(
      normalizeNotificationConfig(config.notifications),
    ),
    storage: sanitizeStorageConfig(config.storage),
    paths: normalizePathConfig(config.paths),
  });
}

export function browserStoredConfig(config: ServerConfig): ServerConfig {
  const { codex: _codex, ...providers } = config.providers ?? {};
  return {
    version: 1,
    default_provider:
      config.default_provider && providers[config.default_provider]
        ? config.default_provider
        : Object.keys(providers)[0],
    providers,
    notifications: normalizeNotificationConfig(config.notifications),
    storage: normalizeStorageConfig(config.storage),
    paths: normalizePathConfig(config.paths),
  };
}

export async function getStoredProvider(name: string) {
  const config = await readConfigRecord();
  const provider = config.providers[name];
  if (!provider || provider.disabled) {
    throw new Error(
      name === "codex"
        ? "静态 Web 不能使用 Codex 凭证，请改用桌面 App 或 Docker。"
        : `Unknown provider: ${name}`,
    );
  }
  return provider;
}

export function requireApiKey(name: string, provider: ProviderConfig) {
  const credential = provider.credentials.api_key;
  if (!credential) throw new Error(`凭证「${name}」缺少 API Key。`);
  if (credential.source !== "file") {
    throw new Error("静态 Web 只支持保留在当前浏览器数据中的 API Key。");
  }
  if (typeof credential.value !== "string" || !credential.value.trim()) {
    throw new Error(`凭证「${name}」的 API Key 为空。`);
  }
  return credential.value.trim();
}

export function selectedProviderName(provider?: string) {
  return provider && provider.trim() ? provider : "";
}
