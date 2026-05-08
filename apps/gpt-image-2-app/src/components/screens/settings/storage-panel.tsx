import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import {
  useTestStorageTarget,
  useUpdatePaths,
  useUpdateStorage,
} from "@/hooks/use-config";
import { api, type ConfigPaths } from "@/lib/api";
import { storageTargetType } from "@/lib/api/shared";
import { runtimeCopy } from "@/lib/runtime-copy";
import type {
  CredentialRef,
  HttpStorageTargetConfig,
  PathConfig,
  SftpStorageTargetConfig,
  StorageConfig,
  StorageFallbackPolicy,
  StorageTargetConfig,
  StorageTargetKind,
  WebDavStorageTargetConfig,
} from "@/lib/types";
import {
  EXPORT_DIR_MODE_OPTIONS,
  METHOD_OPTIONS,
  STORAGE_FALLBACK_POLICY_OPTIONS,
  STORAGE_TARGET_TYPE_OPTIONS,
} from "./constants";
import { CredentialEditor } from "./credential-editor";
import { PathRow, Row, Section } from "./layout";
import {
  blankStorageTarget,
  clonePathConfig,
  cloneStorageConfig,
  normalizeStorageTargetForSave,
  preparePathConfigForSave,
  prepareStorageConfigForSave,
  storageTargetLabel,
} from "./settings-utils";

function ResultFoldersSection({
  paths,
  configPaths,
}: {
  paths?: PathConfig;
  configPaths?: ConfigPaths;
}) {
  const [draft, setDraft] = useState(() => clonePathConfig(paths));
  const updatePaths = useUpdatePaths();
  const customExport = draft.default_export_dir.mode === "custom";
  const previewExportDir = customExport
    ? (draft.default_export_dir.path ?? "")
    : (configPaths?.default_export_dirs?.[draft.default_export_dir.mode] ??
      configPaths?.default_export_dir ??
      "");
  const canSave = Boolean(api.updatePaths) && api.canExportToConfiguredFolder;

  useEffect(() => {
    setDraft(clonePathConfig(paths));
  }, [paths]);

  const patchExportDir = (next: Partial<PathConfig["default_export_dir"]>) => {
    setDraft((current) => ({
      ...current,
      default_export_dir: {
        ...current.default_export_dir,
        ...next,
      },
    }));
  };

  const save = async () => {
    try {
      const saved = await updatePaths.mutateAsync(
        preparePathConfigForSave(draft),
      );
      setDraft(clonePathConfig(saved.paths));
      toast.success("保存位置已更新");
    } catch (error) {
      toast.error("保存位置更新失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <Section
      title="保存到本机"
      description={
        canSave
          ? "点「保存图片」时，会复制到哪个文件夹。"
          : "网页版会用浏览器下载位置，无法指定本机文件夹。"
      }
      headerAction={
        <Button
          variant="primary"
          size="sm"
          disabled={!canSave || updatePaths.isPending}
          onClick={() => void save()}
        >
          保存设置
        </Button>
      }
    >
      <Row
        title="默认文件夹"
        description="App 历史保留所有图；这里只决定「保存图片」复制到哪里。"
        control={
          <div className="grid w-full gap-2 sm:w-[520px] sm:grid-cols-[170px_minmax(0,1fr)]">
            <GlassSelect
              value={draft.default_export_dir.mode}
              onValueChange={(mode) => {
                const nextMode = mode as PathConfig["default_export_dir"]["mode"];
                patchExportDir({
                  mode: nextMode,
                  path:
                    nextMode === "custom"
                      ? (draft.default_export_dir.path ??
                        configPaths?.default_export_dir ??
                        "")
                      : null,
                });
              }}
              options={EXPORT_DIR_MODE_OPTIONS}
              size="sm"
              ariaLabel="默认保存文件夹"
              disabled={!canSave}
            />
            <Input
              value={previewExportDir}
              onChange={(event) =>
                patchExportDir({ path: event.target.value })
              }
              placeholder={
                customExport
                  ? "/Users/you/Pictures/GPT Image 2"
                  : "按所选模式自动决定"
              }
              disabled={!canSave || !customExport}
              size="sm"
              aria-label="自定义保存文件夹"
            />
          </div>
        }
      />
      <PathRow
        title="当前保存位置"
        path={configPaths?.default_export_dir}
        isFolder
        dim
      />
      <PathRow
        title="App 历史目录"
        path={configPaths?.result_library_dir ?? configPaths?.jobs_dir}
        isFolder
        dim
      />
    </Section>
  );
}

export function StoragePanel({
  storage,
  paths,
}: {
  storage?: StorageConfig;
  paths?: PathConfig;
}) {
  const [draft, setDraft] = useState(() => cloneStorageConfig(storage));
  const updateStorage = useUpdateStorage();
  const testStorage = useTestStorageTarget();
  const copy = runtimeCopy();
  const { data: configPaths } = useQuery<ConfigPaths>({
    queryKey: ["config-paths"],
    queryFn: api.configPaths,
    staleTime: 60_000,
  });

  useEffect(() => {
    setDraft(cloneStorageConfig(storage));
  }, [storage]);

  const targetEntries = Object.entries(draft.targets);
  const strategyTargetEntries =
    copy.kind === "browser"
      ? targetEntries.filter(([, target]) => storageTargetType(target) === "local")
      : targetEntries;
  const remoteDraftCount =
    copy.kind === "browser"
      ? targetEntries.length - strategyTargetEntries.length
      : 0;
  const targetOptions = targetEntries.map(([name, target]) => ({
    value: name,
    label: `${name} · ${storageTargetLabel(target)}`,
  }));

  const patch = (next: Partial<StorageConfig>) => {
    setDraft((current) => ({ ...current, ...next }));
  };
  const patchTarget = (
    name: string,
    next: Partial<StorageTargetConfig> | StorageTargetConfig,
  ) => {
    setDraft((current) => ({
      ...current,
      targets: {
        ...current.targets,
        [name]: { ...current.targets[name], ...next } as StorageTargetConfig,
      },
    }));
  };
  const setTargetType = (name: string, type: StorageTargetKind) => {
    patchTarget(name, blankStorageTarget(type));
  };
  const addTarget = () => {
    setDraft((current) => {
      let index = Object.keys(current.targets).length + 1;
      let name = `target-${index}`;
      while (current.targets[name]) {
        index += 1;
        name = `target-${index}`;
      }
      return {
        ...current,
        targets: { ...current.targets, [name]: blankStorageTarget("local") },
      };
    });
  };
  const removeTarget = (name: string) => {
    setDraft((current) => {
      const { [name]: _removed, ...targets } = current.targets;
      return {
        ...current,
        targets,
        default_targets: current.default_targets.filter((item) => item !== name),
        fallback_targets: current.fallback_targets.filter(
          (item) => item !== name,
        ),
      };
    });
  };
  const renameTarget = (name: string, nextName: string) => {
    const clean = nextName.trim();
    if (!clean || clean === name || draft.targets[clean]) return;
    setDraft((current) => {
      const entries = Object.entries(current.targets).map(([key, target]) =>
        key === name ? ([clean, target] as const) : ([key, target] as const),
      );
      return {
        ...current,
        targets: Object.fromEntries(entries),
        default_targets: current.default_targets.map((item) =>
          item === name ? clean : item,
        ),
        fallback_targets: current.fallback_targets.map((item) =>
          item === name ? clean : item,
        ),
      };
    });
  };
  const toggleTargetList = (
    field: "default_targets" | "fallback_targets",
    name: string,
    checked: boolean,
  ) => {
    setDraft((current) => ({
      ...current,
      [field]: checked
        ? Array.from(new Set([...current[field], name]))
        : current[field].filter((item) => item !== name),
    }));
  };
  const addHttpHeader = (name: string) => {
    const target = draft.targets[name];
    if (!target || storageTargetType(target) !== "http" || !("headers" in target))
      return;
    const headers = { ...(target.headers ?? {}) };
    let key = "Authorization";
    let count = 1;
    while (headers[key]) {
      count += 1;
      key = `X-Storage-Secret-${count}`;
    }
    headers[key] = { source: "file", value: "" };
    patchTarget(name, { headers });
  };
  const updateHttpHeader = (
    name: string,
    header: string,
    nextHeader: string,
    credential: CredentialRef | null,
  ) => {
    const target = draft.targets[name];
    if (!target || storageTargetType(target) !== "http" || !("headers" in target))
      return;
    const headers = { ...(target.headers ?? {}) };
    delete headers[header];
    if (credential && nextHeader.trim()) headers[nextHeader] = credential;
    patchTarget(name, { headers });
  };

  const save = async () => {
    try {
      const saved = await updateStorage.mutateAsync(
        prepareStorageConfigForSave(draft),
      );
      setDraft(cloneStorageConfig(saved.storage));
      toast.success("自动上传设置已保存");
    } catch (error) {
      toast.error("保存自动上传设置失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const runTest = async (name: string) => {
    try {
      const result = await testStorage.mutateAsync({
        name,
        target: normalizeStorageTargetForSave(draft.targets[name]),
      });
      if (result.ok) {
        toast.success("上传位置可用", { description: result.message });
      } else {
        toast.warning("上传位置不可用", { description: result.message });
      }
    } catch (error) {
      toast.error("测试上传位置失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      <ResultFoldersSection paths={paths} configPaths={configPaths} />

      <Section
        title="自动上传"
        description={
          copy.kind === "browser"
            ? "网页版只存在浏览器本地，要上传云端请用桌面 App 或自建后端。"
            : "先存进 App 历史，再按下方设置自动上传。"
        }
      >
        <Row
          title="主上传目标"
          description={
            copy.kind === "browser"
              ? "网页版不上传云端，只留浏览器本地。"
              : "任务完成后优先上传到这里。"
          }
          control={
            <div className="flex w-full flex-wrap gap-2 sm:w-[520px]">
              {strategyTargetEntries.map(([name]) => (
                <label
                  key={`default-${name}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-2.5 py-1.5 text-[12px]"
                >
                  <input
                    type="checkbox"
                    checked={draft.default_targets.includes(name)}
                    onChange={(event) =>
                      toggleTargetList(
                        "default_targets",
                        name,
                        event.target.checked,
                      )
                    }
                  />
                  <span>{name}</span>
                </label>
              ))}
              {strategyTargetEntries.length === 0 && (
                <span className="text-[12px] text-muted">暂无上传位置。</span>
              )}
              {remoteDraftCount > 0 && (
                <span className="text-[12px] text-faint">
                  {remoteDraftCount} 个云端位置已配置但不启用。
                </span>
              )}
            </div>
          }
        />
        <Row
          title="备用位置"
          description={
            copy.kind === "browser"
              ? "网页版备用位置只在浏览器本地。"
              : "上传失败时改存到这里，建议保留一个本机位置。"
          }
          control={
            <div className="flex w-full flex-wrap gap-2 sm:w-[520px]">
              {strategyTargetEntries.map(([name]) => (
                <label
                  key={`fallback-${name}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-[color:var(--w-04)] px-2.5 py-1.5 text-[12px]"
                >
                  <input
                    type="checkbox"
                    checked={draft.fallback_targets.includes(name)}
                    onChange={(event) =>
                      toggleTargetList(
                        "fallback_targets",
                        name,
                        event.target.checked,
                      )
                    }
                  />
                  <span>{name}</span>
                </label>
              ))}
              {strategyTargetEntries.length === 0 && (
                <span className="text-[12px] text-muted">暂无备用位置。</span>
              )}
            </div>
          }
        />
        <Row
          title="备用启用时机"
          description="主位置不可用时改用备用。"
          control={
            <GlassSelect
              value={draft.fallback_policy}
              onValueChange={(fallback_policy) =>
                patch({
                  fallback_policy: fallback_policy as StorageFallbackPolicy,
                })
              }
              options={STORAGE_FALLBACK_POLICY_OPTIONS}
              size="sm"
              ariaLabel="备用启用时机"
              className="w-full sm:w-[160px]"
            />
          }
        />
        <Row
          title="并行上传图片数"
          description="一次最多同时上传几张图。"
          control={
            <Input
              value={String(draft.upload_concurrency)}
              onChange={(event) =>
                patch({
                  upload_concurrency: Number(event.target.value) || 1,
                })
              }
              inputMode="numeric"
              size="sm"
              aria-label="并行上传图片数"
              className="w-full sm:w-[100px]"
            />
          }
        />
        <Row
          title="同图并行位置数"
          description="同一张图最多同时传到几个位置。"
          control={
            <Input
              value={String(draft.target_concurrency)}
              onChange={(event) =>
                patch({
                  target_concurrency: Number(event.target.value) || 1,
                })
              }
              inputMode="numeric"
              size="sm"
              aria-label="同图并行位置数"
              className="w-full sm:w-[100px]"
            />
          }
        />
      </Section>

      <Section title="位置列表">
        <div className="space-y-3 px-4 py-3.5 sm:px-5">
          {targetEntries.map(([name, target]) => {
            const type = storageTargetType(target);
            const webdavTarget =
              type === "webdav"
                ? (target as WebDavStorageTargetConfig)
                : undefined;
            const httpTarget =
              type === "http" ? (target as HttpStorageTargetConfig) : undefined;
            const sftpTarget =
              type === "sftp" ? (target as SftpStorageTargetConfig) : undefined;
            return (
              <div
                key={name}
                className="space-y-2 rounded-lg border border-border bg-[color:var(--w-03)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    defaultValue={name}
                    onBlur={(event) => renameTarget(name, event.target.value)}
                    aria-label="上传位置名称"
                    className="h-7 w-full rounded-md border border-border bg-[color:var(--w-04)] px-2.5 font-mono text-[13px] outline-none transition-colors placeholder:text-faint focus:border-[color:var(--accent-55)] focus:bg-[color:var(--accent-06)] focus:shadow-[0_0_0_3px_var(--accent-14)] sm:w-[160px]"
                  />
                  <GlassSelect
                    value={type}
                    onValueChange={(value) =>
                      setTargetType(name, value as StorageTargetKind)
                    }
                    options={STORAGE_TARGET_TYPE_OPTIONS}
                    size="sm"
                    ariaLabel="上传位置类型"
                  />
                  <div className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="play"
                      disabled={testStorage.isPending}
                      onClick={() => void runTest(name)}
                    >
                      测试
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      icon="trash"
                      onClick={() => removeTarget(name)}
                      aria-label="删除上传位置"
                    />
                  </div>
                </div>
                {type === "local" && "directory" in target && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={target.directory}
                      onChange={(event) =>
                        patchTarget(name, { directory: event.target.value })
                      }
                      placeholder="/path/to/storage"
                      size="sm"
                      aria-label="本地目录"
                    />
                    <Input
                      value={target.public_base_url ?? ""}
                      onChange={(event) =>
                        patchTarget(name, {
                          public_base_url: event.target.value,
                        })
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
                        onChange={(event) =>
                          patchTarget(name, { bucket: event.target.value })
                        }
                        placeholder="bucket"
                        size="sm"
                        aria-label="S3 bucket"
                      />
                      <Input
                        value={target.region ?? ""}
                        onChange={(event) =>
                          patchTarget(name, { region: event.target.value })
                        }
                        placeholder="region"
                        size="sm"
                        aria-label="S3 region"
                      />
                      <Input
                        value={target.prefix ?? ""}
                        onChange={(event) =>
                          patchTarget(name, { prefix: event.target.value })
                        }
                        placeholder="prefix/"
                        size="sm"
                        aria-label="S3 prefix"
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={target.endpoint ?? ""}
                        onChange={(event) =>
                          patchTarget(name, { endpoint: event.target.value })
                        }
                        placeholder="S3 endpoint"
                        size="sm"
                        aria-label="S3 endpoint"
                      />
                      <Input
                        value={target.public_base_url ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            public_base_url: event.target.value,
                          })
                        }
                        placeholder="对外访问前缀（可选）"
                        size="sm"
                        aria-label="S3 对外访问前缀"
                      />
                    </div>
                    <CredentialEditor
                      credential={target.access_key_id}
                      onChange={(access_key_id) =>
                        patchTarget(name, { access_key_id })
                      }
                      placeholder="Access Key ID"
                      ariaLabel="S3 Access Key ID"
                    />
                    <CredentialEditor
                      credential={target.secret_access_key}
                      onChange={(secret_access_key) =>
                        patchTarget(name, { secret_access_key })
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
                        onChange={(event) =>
                          patchTarget(name, { url: event.target.value })
                        }
                        placeholder="https://dav.example.com/out"
                        size="sm"
                        aria-label="WebDAV URL"
                      />
                      <Input
                        value={webdavTarget.public_base_url ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            public_base_url: event.target.value,
                          })
                        }
                        placeholder="对外访问前缀（可选）"
                        size="sm"
                        aria-label="WebDAV 对外访问前缀"
                      />
                    </div>
                    <Input
                      value={webdavTarget.username ?? ""}
                      onChange={(event) =>
                        patchTarget(name, { username: event.target.value })
                      }
                      placeholder="username"
                      size="sm"
                      aria-label="WebDAV username"
                    />
                    <CredentialEditor
                      credential={webdavTarget.password}
                      onChange={(password) => patchTarget(name, { password })}
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
                        onChange={(event) =>
                          patchTarget(name, { url: event.target.value })
                        }
                        placeholder="https://upload.example.com"
                        size="sm"
                        aria-label="HTTP upload URL"
                      />
                      <GlassSelect
                        value={httpTarget.method || "POST"}
                        onValueChange={(method) =>
                          patchTarget(name, { method })
                        }
                        options={METHOD_OPTIONS}
                        size="sm"
                        ariaLabel="HTTP method"
                      />
                      <Input
                        value={httpTarget.public_url_json_pointer ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
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
                              updateHttpHeader(
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
                              updateHttpHeader(
                                name,
                                header,
                                header,
                                nextCredential,
                              )
                            }
                            placeholder="Bearer ..."
                            ariaLabel={`${header} 值`}
                          />
                          <Button
                            variant="ghost"
                            size="iconSm"
                            icon="x"
                            onClick={() =>
                              updateHttpHeader(name, header, "", null)
                            }
                            aria-label="删除 HTTP header"
                          />
                        </div>
                      ),
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="plus"
                      onClick={() => addHttpHeader(name)}
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
                        onChange={(event) =>
                          patchTarget(name, { host: event.target.value })
                        }
                        placeholder="host"
                        size="sm"
                        aria-label="SFTP host"
                      />
                      <Input
                        value={String(sftpTarget.port || 22)}
                        onChange={(event) =>
                          patchTarget(name, {
                            port: Number(event.target.value) || 22,
                          })
                        }
                        inputMode="numeric"
                        size="sm"
                        aria-label="SFTP port"
                      />
                      <Input
                        value={sftpTarget.username}
                        onChange={(event) =>
                          patchTarget(name, { username: event.target.value })
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
                          patchTarget(name, { remote_dir: event.target.value })
                        }
                        placeholder="/remote/out"
                        size="sm"
                        aria-label="SFTP remote dir"
                      />
                      <Input
                        value={sftpTarget.public_base_url ?? ""}
                        onChange={(event) =>
                          patchTarget(name, {
                            public_base_url: event.target.value,
                          })
                        }
                        placeholder="对外访问前缀（可选）"
                        size="sm"
                        aria-label="SFTP 对外访问前缀"
                      />
                    </div>
                    <Input
                      value={sftpTarget.host_key_sha256 ?? ""}
                      onChange={(event) =>
                        patchTarget(name, {
                          host_key_sha256: event.target.value,
                        })
                      }
                      placeholder="SHA256 指纹（可选，用于校验）"
                      size="sm"
                      aria-label="SFTP 服务器 SHA256 指纹"
                    />
                    <CredentialEditor
                      credential={sftpTarget.password}
                      onChange={(password) => patchTarget(name, { password })}
                      placeholder="password"
                      ariaLabel="SFTP password"
                    />
                    <CredentialEditor
                      credential={sftpTarget.private_key}
                      onChange={(private_key) =>
                        patchTarget(name, { private_key })
                      }
                      placeholder="private key"
                      ariaLabel="SFTP private key"
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" icon="plus" onClick={addTarget}>
              添加上传位置
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={updateStorage.isPending}
              onClick={() => void save()}
            >
              保存
            </Button>
          </div>
          {targetOptions.length > 0 && (
            <div className="text-[11px] text-faint">
              当前上传位置：{targetOptions.map((item) => item.label).join(" / ")}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
