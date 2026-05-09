import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassSelect } from "@/components/ui/select";
import {
  useTestStorageTarget,
  useUpdateStorage,
} from "@/hooks/use-config";
import { api, type ConfigPaths } from "@/lib/api";
import { storageTargetType } from "@/lib/api/shared";
import { runtimeCopy } from "@/lib/runtime-copy";
import {
  storageConfigIssue,
  storageTargetConfigIssue,
  visibleStorageTargetIssues,
} from "@/lib/storage-validation";
import type {
  CredentialRef,
  PathConfig,
  StorageConfig,
  StorageFallbackPolicy,
  StorageTargetConfig,
  StorageTargetKind,
} from "@/lib/types";
import { STORAGE_FALLBACK_POLICY_OPTIONS } from "./constants";
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
