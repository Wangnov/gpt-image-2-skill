import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/icon";
import { EventTimeline } from "@/components/screens/shared/event-timeline";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { providerKindLabel } from "@/lib/format";
import { useCreateGenerate, useCancelJob } from "@/hooks/use-jobs";
import { useJobEvents } from "@/hooks/use-job-events";
import { useTweaks } from "@/hooks/use-tweaks";
import { api } from "@/lib/api";
import { effectiveDefaultProvider, providerNames as readProviderNames } from "@/lib/providers";
import type { ServerConfig } from "@/lib/types";

const PRESETS = [
  "等距透视的 3D 小房子, 柔和阴影",
  "胶片质感的街头人像, 35mm, 黄昏光线",
  "产品摄影: 亚光陶瓷杯, 纯白背景",
  "水墨写意山水, 留白, 竖幅",
];

export function GenerateScreen({ config }: { config?: ServerConfig }) {
  const { tweaks } = useTweaks();
  const providerNames = useMemo(() => readProviderNames(config), [config]);
  const defaultProvider = effectiveDefaultProvider(config);
  const [prompt, setPrompt] = useState(
    "极简线条风格的日本庭院，俯视视角，晨雾中的石灯笼与枯山水，高细节"
  );
  const [provider, setProvider] = useState<string>("");
  const [size, setSize] = useState("1024x1024");
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState("high");
  const [background, setBackground] = useState("auto");
  const [n, setN] = useState(4);
  const [jobId, setJobId] = useState<string | null>(null);

  const { events, running } = useJobEvents(jobId);
  const mutate = useCreateGenerate();
  const cancel = useCancelJob();

  useEffect(() => {
    if (providerNames.length > 0 && (!provider || !config?.providers[provider])) {
      setProvider(defaultProvider || providerNames[0]);
    }
  }, [config?.providers, defaultProvider, provider, providerNames]);

  const handleRun = async () => {
    if (!provider) return;
    const res = await mutate.mutateAsync({
      prompt,
      provider,
      size,
      format,
      quality,
      background,
      n,
      metadata: { size, format, quality, background, n },
    });
    setJobId(res.job_id);
  };

  const outputs = useMemo(() => {
    if (!jobId) return [];
    return Array.from({ length: Math.max(1, n) }).map((_, index) => ({
      index,
      url: api.outputUrl(jobId, index),
      selected: index === 0,
    }));
  }, [jobId, n]);

  const hasOutputs = outputs.length > 0 && events.some(e => e.type === "output_saved" || e.type === "job.completed");
  const providerCfg = provider ? config?.providers[provider] : undefined;

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_300px] overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col overflow-auto bg-background gridpaper">
        <div className="p-6 pb-4 max-w-[820px] mx-auto w-full">
          <div className="flex items-baseline gap-2 mb-2.5">
            <div className="t-title">图像生成</div>
            <div className="t-small">把想法写成提示词</div>
          </div>
          <div className="bg-raised border border-border rounded-xl p-3.5 shadow-sm">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的图像…"
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun(); }}
              className="w-full min-h-[80px] resize-y bg-transparent border-none outline-none text-[15px] leading-[1.5] text-foreground"
            />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <Button variant="ghost" size="sm" icon="image" disabled>参考图</Button>
              <Button variant="ghost" size="sm" icon="wand" disabled>润色</Button>
              <div className="flex-1 min-w-0" />
              <span className="t-tiny font-mono">{prompt.length} 字</span>
              {!running ? (
                <Button variant="primary" size="md" icon="sparkle" onClick={handleRun} kbd="⌘↵" disabled={mutate.isPending || !provider}>
                  {mutate.isPending ? "提交中…" : "生成"}
                </Button>
              ) : (
                <Button variant="danger" size="md" icon="x" onClick={() => jobId && cancel.mutate(jobId)}>取消</Button>
              )}
            </div>
          </div>
          <div className="flex gap-1.5 mt-2.5 flex-wrap">
            <span className="t-tiny pt-1.5">快速开始</span>
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setPrompt(p)}
                className="px-2.5 py-1 bg-raised border border-border rounded-full text-[11.5px] text-muted"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="px-7 pb-6 pt-3 max-w-[820px] mx-auto w-full flex-1">
          <div className="flex items-center gap-2.5 mb-3">
            <div className="t-h3">
              {running ? `生成中 · ${n} 个候选` : hasOutputs ? `候选 · ${outputs.length}` : "候选"}
            </div>
            {hasOutputs && outputs[0]?.selected && <Badge tone="accent" icon="check">已选 A</Badge>}
            <div className="flex-1" />
            {hasOutputs && (
              <>
                <Button variant="ghost" size="sm" icon="download">保存</Button>
                <Button variant="ghost" size="sm" icon="reload">重新生成</Button>
              </>
            )}
          </div>

          {!hasOutputs && !running ? (
            <Card padding={0}>
              <Empty
                icon="image"
                title="从一句话开始"
                subtitle="写下画面，点「生成」会并行返回候选。请求、服务端事件和本地保存进度会进入右侧时间线。"
              />
            </Card>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: n <= 2 ? "1fr 1fr" : `repeat(${Math.min(n, 4)}, 1fr)` }}>
              {running && !hasOutputs &&
                Array.from({ length: n }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-lg border border-border flex items-center justify-center text-faint font-mono text-[11px] animate-shimmer"
                    style={{
                      background: "linear-gradient(90deg, var(--bg-sunken) 0%, var(--bg-hover) 40%, var(--bg-sunken) 80%)",
                      backgroundSize: "200% 100%",
                    }}
                  >
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
              {hasOutputs && outputs.map((o) => (
                <OutputTile key={o.index} output={o} />
              ))}
            </div>
          )}

          {hasOutputs && jobId && (
            <div className="mt-4 px-3 py-2.5 bg-raised border border-border rounded-lg flex items-center gap-2.5">
              <Icon name="folder" size={14} style={{ color: "var(--text-faint)" }} />
              <div className="flex-1 min-w-0">
                <div className="t-tiny">输出目录</div>
                <div className="t-mono text-[11.5px] truncate">
                  $CODEX_HOME/gpt-image-2-skill/jobs/{jobId}/
                </div>
              </div>
              <Button variant="ghost" size="sm" icon="copy">复制</Button>
            </div>
          )}
        </div>
      </div>

      <div className="border-l border-border bg-raised flex flex-col overflow-hidden">
        <div className="px-4 py-3.5 border-b border-border-faint">
          <Field label="服务商">
            <div className="flex items-center gap-1.5 px-2.5 h-9 bg-sunken border border-border rounded-md">
              <Icon name="cpu" size={14} style={{ color: "var(--accent)" }} />
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[13px] font-medium"
              >
                {providerNames.length === 0 && <option value="">（无可用 provider）</option>}
                {providerNames.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {provider === defaultProvider && <Badge tone="neutral" size="sm">默认</Badge>}
            </div>
            <div className="mt-1.5 flex gap-1.5 text-[11px] text-muted">
              <span className="t-mono">{providerCfg?.model ?? "—"}</span>
              <span>·</span>
              <span>{providerKindLabel(providerCfg?.type)}</span>
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="尺寸">
              <Select value={size} onChange={(e) => setSize(e.target.value)} options={["1024x1024", "1024x1792", "1792x1024", "2048x2048"]} />
            </Field>
            <Field label="质量">
              <Select value={quality} onChange={(e) => setQuality(e.target.value)} options={[{ value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }]} />
            </Field>
            <Field label="格式">
              <Select value={format} onChange={(e) => setFormat(e.target.value)} options={["png", "jpeg", "webp"]} />
            </Field>
            <Field label="背景">
              <Select value={background} onChange={(e) => setBackground(e.target.value)} options={[{ value: "auto", label: "自动" }, { value: "transparent", label: "透明" }, { value: "opaque", label: "不透明" }]} />
            </Field>
          </div>
          <Field label="候选数量">
            <Segmented value={String(n)} onChange={(v) => setN(Number(v))} options={["1", "2", "4", "6"]} />
          </Field>
        </div>

        <div className="px-4 py-3.5 flex-1 overflow-auto flex flex-col">
          <div className="flex items-center gap-2 mb-2.5">
            <div className="t-h3">事件时间线</div>
            {running && <Spinner size={12} />}
            <div className="flex-1" />
            {events.length > 0 && <span className="t-tiny font-mono">{events.length} 条</span>}
          </div>
          <EventTimeline events={events} mode={tweaks.timeline} />
        </div>
      </div>
    </div>
  );
}
