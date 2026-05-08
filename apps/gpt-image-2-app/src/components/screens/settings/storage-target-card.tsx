import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { storageTargetType } from "@/lib/api/shared";
import type {
  CredentialRef,
  HttpStorageTargetConfig,
  SftpStorageTargetConfig,
  StorageTargetConfig,
  StorageTargetKind,
  WebDavStorageTargetConfig,
} from "@/lib/types";
import { METHOD_OPTIONS, STORAGE_TARGET_TYPE_OPTIONS } from "./constants";
import { CredentialEditor } from "./credential-editor";

export function StorageTargetCard({
  name,
  target,
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
          <Input
            value={target.directory}
            onChange={(event) =>
              onPatch(name, { directory: event.target.value })
            }
            placeholder="/path/to/storage"
            size="sm"
            aria-label="本地目录"
          />
          <Input
            value={target.public_base_url ?? ""}
            onChange={(event) =>
              onPatch(name, { public_base_url: event.target.value })
            }
            placeholder="对外访问前缀（可选）"
            size="sm"
            aria-label="对外访问前缀"
          />
        </div>
      )}
      {type === "s3" && "bucket" in target && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              value={target.bucket}
              onChange={(event) => onPatch(name, { bucket: event.target.value })}
              placeholder="bucket"
              size="sm"
              aria-label="S3 bucket"
            />
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
          <CredentialEditor
            credential={target.access_key_id}
            onChange={(access_key_id) => onPatch(name, { access_key_id })}
            placeholder="Access Key ID"
            ariaLabel="S3 Access Key ID"
          />
          <CredentialEditor
            credential={target.secret_access_key}
            onChange={(secret_access_key) =>
              onPatch(name, { secret_access_key })
            }
            placeholder="Secret Access Key"
            ariaLabel="S3 Secret Access Key"
          />
        </div>
      )}
      {webdavTarget && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={webdavTarget.url}
              onChange={(event) => onPatch(name, { url: event.target.value })}
              placeholder="https://dav.example.com/out"
              size="sm"
              aria-label="WebDAV URL"
            />
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
            <Input
              value={httpTarget.url}
              onChange={(event) => onPatch(name, { url: event.target.value })}
              placeholder="https://upload.example.com"
              size="sm"
              aria-label="HTTP upload URL"
            />
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
            <Input
              value={sftpTarget.host}
              onChange={(event) => onPatch(name, { host: event.target.value })}
              placeholder="host"
              size="sm"
              aria-label="SFTP host"
            />
            <Input
              value={String(sftpTarget.port || 22)}
              onChange={(event) =>
                onPatch(name, { port: Number(event.target.value) || 22 })
              }
              inputMode="numeric"
              size="sm"
              aria-label="SFTP port"
            />
            <Input
              value={sftpTarget.username}
              onChange={(event) =>
                onPatch(name, { username: event.target.value })
              }
              placeholder="username"
              size="sm"
              aria-label="SFTP username"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={sftpTarget.remote_dir}
              onChange={(event) =>
                onPatch(name, { remote_dir: event.target.value })
              }
              placeholder="/remote/out"
              size="sm"
              aria-label="SFTP remote dir"
            />
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
          <Input
            value={sftpTarget.host_key_sha256 ?? ""}
            onChange={(event) =>
              onPatch(name, { host_key_sha256: event.target.value })
            }
            placeholder="SHA256 指纹（可选，用于校验）"
            size="sm"
            aria-label="SFTP 服务器 SHA256 指纹"
          />
          <CredentialEditor
            credential={sftpTarget.password}
            onChange={(password) => onPatch(name, { password })}
            placeholder="password"
            ariaLabel="SFTP password"
          />
          <CredentialEditor
            credential={sftpTarget.private_key}
            onChange={(private_key) => onPatch(name, { private_key })}
            placeholder="private key"
            ariaLabel="SFTP private key"
          />
        </div>
      )}
    </div>
  );
}
