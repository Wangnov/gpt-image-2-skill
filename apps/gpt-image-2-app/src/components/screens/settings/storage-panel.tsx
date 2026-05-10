import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import {
  useTestStorageTarget,
  useUpdateStorage,
} from "@/hooks/use-config";
import { api, type ConfigPaths } from "@/lib/api";
import {
  canActAsOrigin,
  defaultPipelineConfig,
  storageTargetType,
} from "@/lib/api/shared";
import { cn } from "@/lib/cn";
import { runtimeCopy } from "@/lib/runtime-copy";
import {
  storageConfigIssue,
  storageTargetConfigIssue,
  visibleStorageTargetIssues,
} from "@/lib/storage-validation";
import type {
  CleanupMode,
  CredentialRef,
  PathConfig,
  PipelineConfig,
  PipelineMode,
  StorageConfig,
  StorageTargetConfig,
  StorageTargetKind,
} from "@/lib/types";
import {
  STORAGE_CLEANUP_MODE_OPTIONS,
  getStoragePipelineModeOptions,
} from "./constants";
import { Row, Section } from "./layout";
import { ResultFoldersSection } from "./result-folders-section";
import {
  blankStorageTarget,
  cloneStorageConfig,
  normalizeStorageTargetForSave,
  prepareStorageConfigForSave,
  storageTargetLabel,
} from "./settings-utils";
import { StorageTargetCard } from "./storage-target-card";

function ControlRail({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("w-full sm:w-[520px]", className)}>{children}</div>;
}

function TargetToggle({
  name,
  checked,
  onChange,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Toggle
      checked={checked}
      onChange={onChange}
      label={name}
      className={cn(
        "h-9 rounded-md border px-3 text-[12.5px] transition-colors",
        checked
          ? "border-[color:var(--accent-45)] bg-[color:var(--accent-10)] text-foreground"
          : "border-border bg-[color:var(--w-04)] text-muted hover:bg-[color:var(--w-07)] hover:text-foreground",
      )}
    />
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
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [testedTargets, setTestedTargets] = useState<Set<string>>(
    () => new Set(),
  );
  const updateStorage = useUpdateStorage();
  const testStorage = useTestStorageTarget();
  const copy = runtimeCopy();
  const requireLocalDirectory = copy.kind !== "browser";
  const { data: configPaths } = useQuery<ConfigPaths>({
    queryKey: ["config-paths"],
    queryFn: api.configPaths,
    staleTime: 60_000,
  });

  useEffect(() => {
    setDraft(cloneStorageConfig(storage));
    setSaveAttempted(false);
    setTestedTargets(new Set());
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
      const pipeline = current.pipeline ?? defaultPipelineConfig();
      return {
        ...current,
        targets,
        pipeline: {
          ...pipeline,
          origin: pipeline.origin === name ? null : pipeline.origin,
          archives: pipeline.archives.filter((item) => item !== name),
        },
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
      const pipeline = current.pipeline ?? defaultPipelineConfig();
      return {
        ...current,
        targets: Object.fromEntries(entries),
        pipeline: {
          ...pipeline,
          origin: pipeline.origin === name ? clean : pipeline.origin,
          archives: pipeline.archives.map((item) =>
            item === name ? clean : item,
          ),
        },
      };
    });
  };
  const patchPipeline = (next: Partial<PipelineConfig>) => {
    setDraft((current) => ({
      ...current,
      pipeline: { ...(current.pipeline ?? defaultPipelineConfig()), ...next },
    }));
  };
  const setPipelineMode = (mode: PipelineMode) => {
    setDraft((current) => {
      const pipeline = current.pipeline ?? defaultPipelineConfig();
      return {
        ...current,
        pipeline: {
          ...pipeline,
          mode,
          // Switching out of cloud_primary clears the now-meaningless origin.
          origin: mode === "cloud_primary" ? pipeline.origin : null,
          // Switching to local_only clears archives so users don't see
          // stale toggles next time they switch back.
          archives: mode === "local_only" ? [] : pipeline.archives,
        },
      };
    });
  };
  const toggleArchive = (name: string, checked: boolean) => {
    setDraft((current) => {
      const pipeline = current.pipeline ?? defaultPipelineConfig();
      const archives = checked
        ? Array.from(new Set([...pipeline.archives, name]))
        : pipeline.archives.filter((item) => item !== name);
      return { ...current, pipeline: { ...pipeline, archives } };
    });
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
    setSaveAttempted(true);
    const issue = storageConfigIssue(draft, { requireLocalDirectory });
    if (issue) {
      toast.warning("存储配置未完成", { description: issue });
      return;
    }
    try {
      const saved = await updateStorage.mutateAsync(
        prepareStorageConfigForSave(draft),
      );
      setDraft(cloneStorageConfig(saved.storage));
      setSaveAttempted(false);
      setTestedTargets(new Set());
      toast.success("结果存储已保存");
    } catch (error) {
      toast.error("保存结果存储失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const runTest = async (name: string) => {
    setTestedTargets((current) => new Set(current).add(name));
    const issue = storageTargetConfigIssue(name, draft.targets[name], {
      requireLocalDirectory,
    });
    if (issue) {
      toast.warning("测试失败", { description: issue });
      return;
    }
    try {
      const result = await testStorage.mutateAsync({
        name,
        target: normalizeStorageTargetForSave(draft.targets[name]),
      });
      if (result.ok) {
        toast.success("存储目标可用", { description: result.message });
      } else {
        toast.warning("存储目标不可用", { description: result.message });
      }
    } catch (error) {
      toast.error("测试存储目标失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const pipeline = draft.pipeline ?? defaultPipelineConfig();
  const originEligibleEntries = strategyTargetEntries.filter(([, target]) =>
    canActAsOrigin(target),
  );
  const originOptions = originEligibleEntries.map(([name, target]) => ({
    value: name,
    label: `${name} · ${storageTargetLabel(target)}`,
  }));
  const cloudPrimaryAvailable = originEligibleEntries.length > 0;
  const archiveEntries =
    pipeline.mode === "cloud_primary"
      ? strategyTargetEntries.filter(([name]) => name !== pipeline.origin)
      : strategyTargetEntries;
  const pipelineModeOptions = getStoragePipelineModeOptions(copy.kind);
  // "本地" semantics flips between Tauri (= the user's laptop) and HTTP (=
  // the server the docker container runs on); the rest of this panel needs
  // the same disambiguation everywhere it says 本地原图 / 本机原图.
  const localOriginTerm = copy.kind === "http" ? "服务器" : "本机";

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5 space-y-4">
      {copy.kind !== "http" && (
        <ResultFoldersSection paths={paths} configPaths={configPaths} />
      )}

      <Section
        title="结果归档策略"
        description={
          copy.kind === "browser"
            ? "网页版只存在浏览器本地，要上传云端请用桌面 App 或自建后端。"
            : "选择原图存放在哪儿，以及要不要复制到其他位置。"
        }
      >
        <Row
          title="模式"
          description="决定原图位置和归档行为。"
          control={
            <div className="w-full sm:w-[520px] space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {pipelineModeOptions.map((option) => {
                  const Icon = option.icon;
                  const active = pipeline.mode === option.value;
                  const disabled =
                    option.value === "cloud_primary" && !cloudPrimaryAvailable;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPipelineMode(option.value)}
                      title={
                        disabled
                          ? "需要先在下方添加一个支持回读的存储位置（local / S3 / WebDAV / SFTP）。"
                          : undefined
                      }
                      className={cn(
                        "flex h-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-[color:var(--accent-45)] bg-[color:var(--accent-10)] text-foreground"
                          : "border-border bg-[color:var(--w-04)] text-muted hover:bg-[color:var(--w-07)] hover:text-foreground",
                        disabled && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium leading-tight">
                          {option.label}
                        </div>
                        <div className="mt-1 text-[11.5px] text-faint leading-snug">
                          {option.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!cloudPrimaryAvailable && (
                <p className="text-[11.5px] text-faint leading-snug">
                  「云端为主」需要先在下方「位置列表」添加一个支持回读的存储（local / S3 / WebDAV / SFTP），仅推送的目标（如 HTTP/Webhook）不能作为原图。
                </p>
              )}
            </div>
          }
        />
        {pipeline.mode === "cloud_primary" && (
          <Row
            title="云端原图位置"
            description="必须是支持回读的存储类型；HTTP/Webhook 等仅推送的目标不可作为原图。"
            control={
              <ControlRail>
                {originOptions.length === 0 ? (
                  <span className="text-[12px] text-muted">
                    没有可用的原图位置；请先在下方添加一个支持回读的存储（local / S3 / WebDAV / SFTP）。
                  </span>
                ) : (
                  <GlassSelect
                    value={pipeline.origin ?? ""}
                    onValueChange={(value) =>
                      patchPipeline({ origin: value || null })
                    }
                    options={originOptions}
                    placeholder="请选择原图位置"
                    size="sm"
                    ariaLabel="云端原图位置"
                    className="w-full sm:w-[280px]"
                  />
                )}
              </ControlRail>
            }
          />
        )}
        {pipeline.mode !== "local_only" && (
          <Row
            title={
              pipeline.mode === "mirror"
                ? "归档目标"
                : pipeline.mode === "cloud_primary"
                  ? "额外归档"
                  : "推送目标"
            }
            description={
              pipeline.mode === "mirror"
                ? "任务完成后，会复制到这里。"
                : pipeline.mode === "cloud_primary"
                  ? "除原图外，还要异步复制到这些位置（可选）。"
                  : "任务完成后推送到这些位置。"
            }
            control={
              <ControlRail className="flex flex-wrap items-center gap-2">
                {archiveEntries.map(([name]) => (
                  <TargetToggle
                    key={`archive-${name}`}
                    name={name}
                    checked={pipeline.archives.includes(name)}
                    onChange={(checked) => toggleArchive(name, checked)}
                  />
                ))}
                {archiveEntries.length === 0 && (
                  <span className="text-[12px] text-muted">
                    暂无可选归档位置。
                  </span>
                )}
                {remoteDraftCount > 0 && (
                  <span className="text-[12px] text-faint">
                    {remoteDraftCount} 个云端位置已配置但不启用。
                  </span>
                )}
              </ControlRail>
            }
          />
        )}
        <Row
          title="清理策略"
          description={`${localOriginTerm}原图的清理时机。绝大多数选项即将上线。`}
          control={
            <ControlRail>
              <GlassSelect
                value={pipeline.cleanup.mode}
                onValueChange={(value) =>
                  patchPipeline({
                    cleanup: { ...pipeline.cleanup, mode: value as CleanupMode },
                  })
                }
                options={STORAGE_CLEANUP_MODE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.badge
                    ? `${option.label}（${option.badge}）`
                    : option.label,
                  disabled: option.disabled,
                }))}
                size="sm"
                ariaLabel="清理策略"
                className="w-full sm:w-[240px]"
              />
            </ControlRail>
          }
        />
        <Row
          title="并行上传图片数"
          description="一次最多同时上传几张图。"
          control={
            <ControlRail>
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
                wrapperClassName="w-full sm:w-[120px]"
              />
            </ControlRail>
          }
        />
        <Row
          title="同图并行位置数"
          description="同一张图最多同时传到几个位置。"
          control={
            <ControlRail>
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
                wrapperClassName="w-full sm:w-[120px]"
              />
            </ControlRail>
          }
        />
      </Section>

      <Section title="位置列表">
        <div className="space-y-3 px-4 py-3.5 sm:px-5">
          {targetEntries.map(([name, target]) => {
            const targetIssues = visibleStorageTargetIssues(
              name,
              target,
              { saveAttempted, testedTargets },
              { requireLocalDirectory },
            );
            return (
              <StorageTargetCard
                key={name}
                name={name}
                target={target}
                issues={targetIssues}
                testPending={testStorage.isPending}
                onRename={renameTarget}
                onSetType={setTargetType}
                onPatch={patchTarget}
                onRemove={removeTarget}
                onRunTest={(targetName) => void runTest(targetName)}
                onAddHttpHeader={addHttpHeader}
                onUpdateHttpHeader={updateHttpHeader}
              />
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
