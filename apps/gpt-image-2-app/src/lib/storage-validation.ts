import { storageTargetType } from "./api/shared";
import type { CredentialRef, StorageConfig, StorageTargetConfig } from "./types";

type StorageValidationOptions = {
  requireLocalDirectory?: boolean;
};

export type StorageValidationVisibility = {
  saveAttempted?: boolean;
  testedTargets?: Iterable<string>;
};

export type StorageFieldIssue = {
  field: string;
  message: string;
};

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}

function credentialHasReference(credential?: CredentialRef | null) {
  if (!credential) return false;
  if (credential.source === "file") {
    return (
      (typeof credential.value === "string" && credential.value.trim() !== "") ||
      Boolean(credential.present)
    );
  }
  if (credential.source === "env") return hasText(credential.env);
  if (credential.source === "keychain") {
    return hasText(credential.service) && hasText(credential.account);
  }
  return false;
}

function required(field: string, message: string): StorageFieldIssue {
  return { field, message };
}

export function storageTargetConfigIssues(
  name: string,
  target?: StorageTargetConfig,
  options: StorageValidationOptions = {},
) {
  if (!target) {
    return [required("target", `存储目标「${name.trim() || "未命名"}」不存在。`)];
  }
  const type = storageTargetType(target);
  const issues: StorageFieldIssue[] = [];
  if (type === "local") {
    if (options.requireLocalDirectory === false) return issues;
    const directory = "directory" in target ? target.directory : "";
    if (!hasText(directory)) issues.push(required("directory", "请填写本地目录。"));
    return issues;
  }
  if (type === "s3" && "bucket" in target) {
    if (!hasText(target.bucket)) issues.push(required("bucket", "请填写 S3 bucket。"));
    if (!credentialHasReference(target.access_key_id)) {
      issues.push(required("access_key_id", "请填写 S3 Access Key ID。"));
    }
    if (!credentialHasReference(target.secret_access_key)) {
      issues.push(required("secret_access_key", "请填写 S3 Secret Access Key。"));
    }
    return issues;
  }
  if (type === "webdav" && "url" in target) {
    if (!hasText(target.url)) issues.push(required("url", "请填写 WebDAV URL。"));
    return issues;
  }
  if (type === "http" && "url" in target) {
    if (!hasText(target.url)) issues.push(required("url", "请填写 HTTP 上传 URL。"));
    return issues;
  }
  if (type === "sftp" && "host" in target) {
    if (!hasText(target.host)) issues.push(required("host", "请填写 SFTP host。"));
    if (!hasText(target.host_key_sha256)) {
      issues.push(required("host_key_sha256", "请填写 SFTP host key 指纹。"));
    }
    if (!hasText(target.username)) {
      issues.push(required("username", "请填写 SFTP username。"));
    }
    if (!hasText(target.remote_dir)) {
      issues.push(required("remote_dir", "请填写 SFTP 远端目录。"));
    }
    if (
      !credentialHasReference(target.password) &&
      !credentialHasReference(target.private_key)
    ) {
      issues.push(required("sftp_auth", "请填写 SFTP 密码或私钥。"));
    }
    return issues;
  }
  if (type === "baidu_netdisk" && "app_key" in target) {
    if (!hasText(target.app_name)) {
      issues.push(required("app_name", "请填写百度网盘应用目录名。"));
    }
    const authMode = target.auth_mode === "oauth" ? "oauth" : "personal";
    if (authMode === "personal") {
      if (!credentialHasReference(target.access_token)) {
        issues.push(required("access_token", "请填写百度网盘 Access Token。"));
      }
    } else {
      if (!hasText(target.app_key)) {
        issues.push(required("app_key", "请填写百度网盘 App Key。"));
      }
      if (!credentialHasReference(target.secret_key)) {
        issues.push(required("secret_key", "请填写百度网盘 Secret Key。"));
      }
      if (!credentialHasReference(target.refresh_token)) {
        issues.push(required("refresh_token", "请填写百度网盘 Refresh Token。"));
      }
    }
    return issues;
  }
  if (type === "pan123_open" && "client_id" in target) {
    const authMode =
      target.auth_mode === "access_token" ? "access_token" : "client";
    if (authMode === "access_token") {
      if (!credentialHasReference(target.access_token)) {
        issues.push(required("access_token", "请填写 123 网盘 accessToken。"));
      }
    } else {
      if (!hasText(target.client_id)) {
        issues.push(required("client_id", "请填写 123 网盘 clientID。"));
      }
      if (!credentialHasReference(target.client_secret)) {
        issues.push(required("client_secret", "请填写 123 网盘 clientSecret。"));
      }
    }
    return issues;
  }
  return issues;
}

export function storageTargetConfigIssue(
  name: string,
  target?: StorageTargetConfig,
  options: StorageValidationOptions = {},
) {
  const displayName = name.trim() || "未命名";
  const issue = storageTargetConfigIssues(name, target, options)[0];
  if (issue?.field === "directory") {
    return `存储目标「${displayName}」需要填写本地目录。`;
  }
  return issue ? `存储目标「${displayName}」${issue.message}` : null;
}

export function storageConfigIssue(
  config: StorageConfig,
  options: StorageValidationOptions = {},
) {
  for (const [name, target] of Object.entries(config.targets)) {
    const issue = storageTargetConfigIssue(name, target, options);
    if (issue) return issue;
  }
  return null;
}

export function visibleStorageTargetIssues(
  name: string,
  target: StorageTargetConfig | undefined,
  visibility: StorageValidationVisibility = {},
  options: StorageValidationOptions = {},
) {
  const testedTargets = new Set(visibility.testedTargets ?? []);
  if (!visibility.saveAttempted && !testedTargets.has(name)) return [];
  return storageTargetConfigIssues(name, target, options);
}
