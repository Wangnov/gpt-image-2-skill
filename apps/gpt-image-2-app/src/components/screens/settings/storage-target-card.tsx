import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { storageTargetType } from "@/lib/api/shared";
import type { StorageFieldIssue } from "@/lib/storage-validation";
import type {
  BaiduNetdiskStorageTargetConfig,
  CredentialRef,
  HttpStorageTargetConfig,
  Pan123OpenStorageTargetConfig,
  SftpStorageTargetConfig,
  StorageTargetConfig,
  StorageTargetKind,
  WebDavStorageTargetConfig,
} from "@/lib/types";
import {
  BAIDU_AUTH_MODE_OPTIONS,
  BAIDU_NETDISK_HINT,
  LOCAL_PUBLIC_BASE_URL_HINT,
  METHOD_OPTIONS,
  PAN123_AUTH_MODE_OPTIONS,
  PAN123_OPEN_HINT,
  STORAGE_TARGET_TYPE_OPTIONS,
} from "./constants";
import { CredentialEditor } from "./credential-editor";

function HintButton({
  text,
  ariaLabel = "查看对接条件",
}: {
  text: string;
  ariaLabel?: string;
}) {
  return (
    <Tooltip text={text}>
      <button
        type="button"
        aria-label={ariaLabel}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-muted transition-colors hover:border-[color:var(--accent-45)] hover:text-foreground"
      >
        ?
      </button>
    </Tooltip>
  );
}

function issueForField(issues: StorageFieldIssue[], field: string) {
  return issues.find((issue) => issue.field === field)?.message;
}

function StorageField({
  error,
  required,
  children,
}: {
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      {required && (
        <div className="text-right text-[11px] font-semibold leading-none text-[color:var(--accent-70)]">
          *
        </div>
      )}
      {children}
      {error && (
        <div className="text-[11px] leading-snug text-status-err">{error}</div>
      )}
    </div>
  );
}

export function StorageTargetCard({
  name,
  target,
  issues = [],
  testPending,
  onRename,
  onSetType,
  onPatch,
  onRemove,
  onRunTest,
  onAddHttpHeader,
  onUpdateHttpHeader,
}: {
  name: string;
  target: StorageTargetConfig;
  issues?: StorageFieldIssue[];
  testPending: boolean;
  onRename: (name: string, nextName: string) => void;
  onSetType: (name: string, type: StorageTargetKind) => void;
  onPatch: (
    name: string,
    next: Partial<StorageTargetConfig> | StorageTargetConfig,
  ) => void;
  onRemove: (name: string) => void;
  onRunTest: (name: string) => void;
  onAddHttpHeader: (name: string) => void;
  onUpdateHttpHeader: (
    name: string,
    header: string,
    nextHeader: string,
    credential: CredentialRef | null,
  ) => void;
}) {
  const type = storageTargetType(target);
  const webdavTarget =
    type === "webdav" ? (target as WebDavStorageTargetConfig) : undefined;
  const httpTarget =
    type === "http" ? (target as HttpStorageTargetConfig) : undefined;
  const sftpTarget =
    type === "sftp" ? (target as SftpStorageTargetConfig) : undefined;
  const baiduTarget =
    type === "baidu_netdisk"
      ? (target as BaiduNetdiskStorageTargetConfig)
      : undefined;
  const pan123Target =
    type === "pan123_open"
      ? (target as Pan123OpenStorageTargetConfig)
      : undefined;
  const baiduAuthMode = baiduTarget?.auth_mode === "oauth" ? "oauth" : "personal";
  const pan123AuthMode =
    pan123Target?.auth_mode === "access_token" ? "access_token" : "client";
  const fieldError = (field: string) => issueForField(issues, field);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-[color:var(--w-03)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          defaultValue={name}
          onBlur={(event) => onRename(name, event.target.value)}
          aria-label="上传位置名称"
          className="h-7 w-full rounded-md border border-border bg-[color:var(--w-04)] px-2.5 font-mono text-[13px] outline-none transition-colors placeholder:text-faint focus:border-[color:var(--accent-55)] focus:bg-[color:var(--accent-06)] focus:shadow-[0_0_0_3px_var(--accent-14)] sm:w-[160px]"
        />
        <GlassSelect
          value={type}
          onValueChange={(value) => onSetType(name, value as StorageTargetKind)}
          options={STORAGE_TARGET_TYPE_OPTIONS}
          size="sm"
          ariaLabel="上传位置类型"
        />
        <div className="flex h-7 w-7 shrink-0 items-center justify-center">
          {type === "baidu_netdisk" && <HintButton text={BAIDU_NETDISK_HINT} />}
          {type === "pan123_open" && <HintButton text={PAN123_OPEN_HINT} />}
        </div>
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon="play"
            disabled={testPending}
            onClick={() => onRunTest(name)}
          >
            测试
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            icon="trash"
            onClick={() => onRemove(name)}
            aria-label="删除上传位置"
          />
        </div>
      </div>
      {type === "local" && "directory" in target && (
        <div className="grid gap-2 sm:grid-cols-2">
          <StorageField error={fieldError("directory")} required>
            <Input
              value={target.directory}
              onChange={(event) =>
                onPatch(name, { directory: event.target.value })
              }
              placeholder="/path/to/storage"
              size="sm"
              aria-label="本地目录"
              aria-invalid={Boolean(fieldError("directory"))}
            />
          </StorageField>
          <StorageField>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
                <span>公开访问前缀（可选）</span>
                <HintButton
                  text={LOCAL_PUBLIC_BASE_URL_HINT}
                  ariaLabel="查看公开访问前缀说明"
                />
              </div>
              <Input
                value={target.public_base_url ?? ""}
                onChange={(event) =>
                  onPatch(name, { public_base_url: event.target.value })
                }
                placeholder="https://cdn.example.com/images"
                size="sm"
                aria-label="公开访问前缀"
              />
              <p className="text-[11px] leading-snug text-muted">
                用于生成可访问图片 URL；没有静态访问服务时留空。
              </p>
            </div>
          </StorageField>
        </div>
      )}
      {type === "s3" && "bucket" in target && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <StorageField error={fieldError("bucket")} required>
              <Input
                value={target.bucket}
                onChange={(event) => onPatch(name, { bucket: event.target.value })}
                placeholder="bucket"
                size="sm"
                aria-label="S3 bucket"
                aria-invalid={Boolean(fieldError("bucket"))}
              />
            </StorageField>
            <Input
              value={target.region ?? ""}
              onChange={(event) => onPatch(name, { region: event.target.value })}
              placeholder="region"
              size="sm"
              aria-label="S3 region"
            />
            <Input
              value={target.prefix ?? ""}
              onChange={(event) => onPatch(name, { prefix: event.target.value })}
              placeholder="prefix/"
              size="sm"
              aria-label="S3 prefix"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={target.endpoint ?? ""}
              onChange={(event) =>
                onPatch(name, { endpoint: event.target.value })
              }
              placeholder="S3 endpoint"
              size="sm"
              aria-label="S3 endpoint"
            />
            <Input
              value={target.public_base_url ?? ""}
              onChange={(event) =>
                onPatch(name, { public_base_url: event.target.value })
              }
              placeholder="对外访问前缀（可选）"
              size="sm"
              aria-label="S3 对外访问前缀"
            />
          </div>
          <StorageField error={fieldError("access_key_id")} required>
            <CredentialEditor
              credential={target.access_key_id}
              onChange={(access_key_id) => onPatch(name, { access_key_id })}
              placeholder="Access Key ID"
              ariaLabel="S3 Access Key ID"
              invalid={Boolean(fieldError("access_key_id"))}
            />
          </StorageField>
          <StorageField error={fieldError("secret_access_key")} required>
            <CredentialEditor
              credential={target.secret_access_key}
              onChange={(secret_access_key) =>
                onPatch(name, { secret_access_key })
              }
              placeholder="Secret Access Key"
              ariaLabel="S3 Secret Access Key"
              invalid={Boolean(fieldError("secret_access_key"))}
            />
          </StorageField>
        </div>
      )}
      {webdavTarget && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <StorageField error={fieldError("url")} required>
              <Input
                value={webdavTarget.url}
                onChange={(event) => onPatch(name, { url: event.target.value })}
                placeholder="https://dav.example.com/out"
                size="sm"
                aria-label="WebDAV URL"
                aria-invalid={Boolean(fieldError("url"))}
              />
            </StorageField>
            <Input
              value={webdavTarget.public_base_url ?? ""}
              onChange={(event) =>
                onPatch(name, { public_base_url: event.target.value })
              }
              placeholder="对外访问前缀（可选）"
              size="sm"
              aria-label="WebDAV 对外访问前缀"
            />
          </div>
          <Input
            value={webdavTarget.username ?? ""}
            onChange={(event) => onPatch(name, { username: event.target.value })}
            placeholder="username"
            size="sm"
            aria-label="WebDAV username"
          />
          <CredentialEditor
            credential={webdavTarget.password}
            onChange={(password) => onPatch(name, { password })}
            placeholder="password"
            ariaLabel="WebDAV password"
          />
        </div>
      )}
      {httpTarget && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_150px]">
            <StorageField error={fieldError("url")} required>
              <Input
                value={httpTarget.url}
                onChange={(event) => onPatch(name, { url: event.target.value })}
                placeholder="https://upload.example.com"
                size="sm"
                aria-label="HTTP upload URL"
                aria-invalid={Boolean(fieldError("url"))}
              />
            </StorageField>
            <GlassSelect
              value={httpTarget.method || "POST"}
              onValueChange={(method) => onPatch(name, { method })}
              options={METHOD_OPTIONS}
              size="sm"
              ariaLabel="HTTP method"
            />
            <Input
              value={httpTarget.public_url_json_pointer ?? ""}
              onChange={(event) =>
                onPatch(name, {
                  public_url_json_pointer: event.target.value,
                })
              }
              placeholder="/data/url"
              size="sm"
              aria-label="JSON 中公开 URL 的字段路径"
            />
          </div>
          {Object.entries(httpTarget.headers ?? {}).map(
            ([header, credential]) => (
              <div
                key={`${name}:${header}`}
                className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_32px]"
              >
                <Input
                  value={header}
                  onChange={(event) =>
                    onUpdateHttpHeader(
                      name,
                      header,
                      event.target.value,
                      credential,
                    )
                  }
                  placeholder="Authorization"
                  size="sm"
                  monospace
                  aria-label="HTTP header"
                />
                <CredentialEditor
                  credential={credential}
                  onChange={(nextCredential) =>
                    onUpdateHttpHeader(name, header, header, nextCredential)
                  }
                  placeholder="Bearer ..."
                  ariaLabel={`${header} 值`}
                />
                <Button
                  variant="ghost"
                  size="iconSm"
                  icon="x"
                  onClick={() => onUpdateHttpHeader(name, header, "", null)}
                  aria-label="删除 HTTP header"
                />
              </div>
            ),
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="plus"
            onClick={() => onAddHttpHeader(name)}
          >
            添加 Header
          </Button>
        </div>
      )}
      {sftpTarget && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)]">
            <StorageField error={fieldError("host")} required>
              <Input
                value={sftpTarget.host}
                onChange={(event) => onPatch(name, { host: event.target.value })}
                placeholder="host"
                size="sm"
                aria-label="SFTP host"
                aria-invalid={Boolean(fieldError("host"))}
              />
            </StorageField>
            <Input
              value={String(sftpTarget.port || 22)}
              onChange={(event) =>
                onPatch(name, { port: Number(event.target.value) || 22 })
              }
              inputMode="numeric"
              size="sm"
              aria-label="SFTP port"
            />
            <StorageField error={fieldError("username")} required>
              <Input
                value={sftpTarget.username}
                onChange={(event) =>
                  onPatch(name, { username: event.target.value })
                }
                placeholder="username"
                size="sm"
                aria-label="SFTP username"
                aria-invalid={Boolean(fieldError("username"))}
              />
            </StorageField>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <StorageField error={fieldError("remote_dir")} required>
              <Input
                value={sftpTarget.remote_dir}
                onChange={(event) =>
                  onPatch(name, { remote_dir: event.target.value })
                }
                placeholder="/remote/out"
                size="sm"
                aria-label="SFTP remote dir"
                aria-invalid={Boolean(fieldError("remote_dir"))}
              />
            </StorageField>
            <Input
              value={sftpTarget.public_base_url ?? ""}
              onChange={(event) =>
                onPatch(name, { public_base_url: event.target.value })
              }
              placeholder="对外访问前缀（可选）"
              size="sm"
              aria-label="SFTP 对外访问前缀"
            />
          </div>
          <StorageField error={fieldError("host_key_sha256")} required>
            <Input
              value={sftpTarget.host_key_sha256 ?? ""}
              onChange={(event) =>
                onPatch(name, { host_key_sha256: event.target.value })
              }
              placeholder="SHA256 指纹"
              size="sm"
              aria-label="SFTP 服务器 SHA256 指纹"
              aria-invalid={Boolean(fieldError("host_key_sha256"))}
            />
          </StorageField>
          <StorageField error={fieldError("sftp_auth")} required>
            <CredentialEditor
              credential={sftpTarget.password}
              onChange={(password) => onPatch(name, { password })}
              placeholder="password"
              ariaLabel="SFTP password"
              invalid={Boolean(fieldError("sftp_auth"))}
            />
          </StorageField>
          <CredentialEditor
            credential={sftpTarget.private_key}
            onChange={(private_key) => onPatch(name, { private_key })}
            placeholder="private key"
            ariaLabel="SFTP private key"
            invalid={Boolean(fieldError("sftp_auth"))}
          />
        </div>
      )}
      {baiduTarget && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={baiduAuthMode}
              onChange={(auth_mode) => onPatch(name, { auth_mode })}
              options={BAIDU_AUTH_MODE_OPTIONS}
              size="sm"
              ariaLabel="百度网盘对接方式"
            />
            <span className="text-[11px] text-faint">
              {baiduAuthMode === "personal"
                ? "个人对接只需要长期 Access Token。"
                : "OAuth 对接使用应用凭证换取访问令牌。"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <StorageField error={fieldError("app_name")} required>
              <Input
                value={baiduTarget.app_name}
                onChange={(event) =>
                  onPatch(name, { app_name: event.target.value })
                }
                placeholder="应用目录名"
                size="sm"
                aria-label="百度网盘应用目录名"
                aria-invalid={Boolean(fieldError("app_name"))}
              />
            </StorageField>
            <Input
              value={baiduTarget.remote_dir ?? ""}
              onChange={(event) =>
                onPatch(name, { remote_dir: event.target.value })
              }
              placeholder="outputs"
              size="sm"
              aria-label="百度网盘远端目录"
            />
          </div>
          <Input
            value={baiduTarget.public_base_url ?? ""}
            onChange={(event) =>
              onPatch(name, { public_base_url: event.target.value })
            }
            placeholder="公开基础 URL（可选）"
            size="sm"
            aria-label="百度网盘公开基础 URL"
          />
          {baiduAuthMode === "personal" && (
            <StorageField error={fieldError("access_token")} required>
              <CredentialEditor
                credential={baiduTarget.access_token}
                onChange={(access_token) => onPatch(name, { access_token })}
                placeholder="Access Token"
                ariaLabel="百度网盘 Access Token"
                invalid={Boolean(fieldError("access_token"))}
              />
            </StorageField>
          )}
          {baiduAuthMode === "oauth" && (
            <div className="space-y-2">
              <StorageField error={fieldError("app_key")} required>
                <Input
                  value={baiduTarget.app_key}
                  onChange={(event) =>
                    onPatch(name, { app_key: event.target.value })
                  }
                  placeholder="App Key"
                  size="sm"
                  aria-label="百度网盘 App Key"
                  aria-invalid={Boolean(fieldError("app_key"))}
                  suffix={<HintButton text={BAIDU_NETDISK_HINT} />}
                />
              </StorageField>
              <StorageField error={fieldError("secret_key")} required>
                <CredentialEditor
                  credential={baiduTarget.secret_key}
                  onChange={(secret_key) => onPatch(name, { secret_key })}
                  placeholder="Secret Key"
                  ariaLabel="百度网盘 Secret Key"
                  invalid={Boolean(fieldError("secret_key"))}
                />
              </StorageField>
              <StorageField error={fieldError("refresh_token")} required>
                <CredentialEditor
                  credential={baiduTarget.refresh_token}
                  onChange={(refresh_token) =>
                    onPatch(name, { refresh_token })
                  }
                  placeholder="Refresh Token"
                  ariaLabel="百度网盘 Refresh Token"
                  invalid={Boolean(fieldError("refresh_token"))}
                />
              </StorageField>
            </div>
          )}
        </div>
      )}
      {pan123Target && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              value={pan123AuthMode}
              onChange={(auth_mode) => onPatch(name, { auth_mode })}
              options={PAN123_AUTH_MODE_OPTIONS}
              size="sm"
              ariaLabel="123 网盘对接方式"
            />
            <span className="text-[11px] text-faint">
              {pan123AuthMode === "client"
                ? "client 对接使用 clientID + clientSecret。"
                : "accessToken 对接只需要长期 accessToken。"}
            </span>
          </div>
          <Input
            value={String(pan123Target.parent_id || 0)}
            onChange={(event) =>
              onPatch(name, { parent_id: Number(event.target.value) || 0 })
            }
            inputMode="numeric"
            size="sm"
            aria-label="123 网盘父目录 ID"
          />
          <label className="flex items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-2.5 py-1.5 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={pan123Target.use_direct_link}
              onChange={(event) =>
                onPatch(name, { use_direct_link: event.target.checked })
              }
            />
            <span>上传后尝试获取直链</span>
            <HintButton text={PAN123_OPEN_HINT} />
          </label>
          {pan123AuthMode === "client" && (
            <div className="space-y-2">
              <StorageField error={fieldError("client_id")} required>
                <Input
                  value={pan123Target.client_id}
                  onChange={(event) =>
                    onPatch(name, { client_id: event.target.value })
                  }
                  placeholder="clientID"
                  size="sm"
                  aria-label="123 网盘 clientID"
                  aria-invalid={Boolean(fieldError("client_id"))}
                  suffix={<HintButton text={PAN123_OPEN_HINT} />}
                />
              </StorageField>
              <StorageField error={fieldError("client_secret")} required>
                <CredentialEditor
                  credential={pan123Target.client_secret}
                  onChange={(client_secret) =>
                    onPatch(name, { client_secret })
                  }
                  placeholder="clientSecret"
                  ariaLabel="123 网盘 clientSecret"
                  invalid={Boolean(fieldError("client_secret"))}
                />
              </StorageField>
            </div>
          )}
          {pan123AuthMode === "access_token" && (
            <StorageField error={fieldError("access_token")} required>
              <CredentialEditor
                credential={pan123Target.access_token}
                onChange={(access_token) => onPatch(name, { access_token })}
                placeholder="accessToken"
                ariaLabel="123 网盘 accessToken"
                invalid={Boolean(fieldError("access_token"))}
              />
            </StorageField>
          )}
        </div>
      )}
    </div>
  );
}
