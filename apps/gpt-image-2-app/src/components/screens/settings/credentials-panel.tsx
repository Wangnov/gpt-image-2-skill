import { useEffect, useState } from "react";
import { AnimatePresence, motion, useAnimationControls } from "motion/react";
import { Check, Eye, Loader2, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ProviderLogo } from "@/components/provider-logo";
import { AddProviderDialog } from "@/components/screens/providers/add-provider-dialog";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirm } from "@/hooks/use-confirm";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  useDeleteProvider,
  useSetDefaultProvider,
  useTestProvider,
} from "@/hooks/use-config";
import { cn } from "@/lib/cn";
import { credentialSecretDisplay } from "@/lib/credential-display";
import { effectiveDefaultProvider } from "@/lib/providers";
import type { ProviderConfig, ServerConfig } from "@/lib/types";

/* ── CredIcon: visual marker per provider type ─────────────── */
function CredIcon({ kind }: { kind: ProviderConfig["type"] }) {
  return <ProviderLogo kind={kind} size="md" />;
}

type CredCardProps = {
  name: string;
  prov: ProviderConfig;
  isDefault: boolean;
  testStatus?: "idle" | "running" | "ok" | "err";
  onEdit: () => void;
  onUse: () => void;
  onTest: () => void;
  onDelete: () => void;
};

function CredCard({
  name,
  prov,
  isDefault,
  testStatus,
  onEdit,
  onUse,
  onTest,
  onDelete,
}: CredCardProps) {
  const confirm = useConfirm();
  const reducedMotion = useReducedMotion();
  // Bumped on every transition into "ok" / "err" so the success ring
  // (or failure shake) replays even when the user clicks 测试 twice
  // in a row and lands on the same terminal state. Without this the
  // motion would only fire on the very first state change.
  const [resultPulseKey, setResultPulseKey] = useState(0);
  useEffect(() => {
    if (testStatus === "ok" || testStatus === "err") {
      setResultPulseKey((k) => k + 1);
    }
  }, [testStatus]);
  // Imperative shake on each "err" transition. Previously the button
  // got `key={\`err-${resultPulseKey}\`}` so React would unmount and
  // remount it on every failure, which is the standard "remount to
  // replay" trick — but it dropped keyboard focus mid-retry. Using
  // animation controls keeps the DOM stable and replays the keyframes
  // on resultPulseKey bumps so consecutive failures still cue.
  const shakeControls = useAnimationControls();
  useEffect(() => {
    if (testStatus === "err" && !reducedMotion) {
      void shakeControls.start({
        x: [0, -2, 2, -1.5, 1.5, 0],
        transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
      });
    }
  }, [resultPulseKey, testStatus, reducedMotion, shakeControls]);
  // Surface a key value if any credential exposes a literal value.
  const apiKeyCredential = Object.values(prov.credentials ?? {}).find(
    (c) =>
      c?.source === "file" || c?.source === "env" || c?.source === "keychain",
  );
  const apiKeyDisplay = credentialSecretDisplay(apiKeyCredential);

  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors",
        isDefault
          ? "border-[color:var(--accent-30)] bg-[color:var(--accent-04)]"
          : "border-border bg-[color:var(--w-04)] hover:bg-[color:var(--w-05)]",
      )}
    >
      <CredIcon kind={prov.type} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-foreground">
            {name}
          </span>
          {isDefault && (
            <span
              className="text-[10.5px] font-medium tracking-wide"
              style={{ color: "var(--status-ok-soft)" }}
            >
              当前使用
            </span>
          )}
          <span className="t-caps">
            {prov.type === "openai-compatible"
              ? "OpenAI 兼容"
              : prov.type === "codex"
                ? "Codex"
                : "OpenAI"}
          </span>
        </div>
        <div className="mt-1 space-y-0.5">
          {prov.api_base && (
            <div className="text-[11.5px] text-muted">
              <span className="text-faint">Base URL </span>
              <span className="break-all font-mono">{prov.api_base}</span>
            </div>
          )}
          {apiKeyDisplay && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-muted">
              <span className="text-faint">API Key </span>
              <span className="font-mono">{apiKeyDisplay}</span>
              <Eye size={12} className="opacity-50" aria-hidden />
            </div>
          )}
          {prov.model && (
            <div className="text-[11px] text-faint font-mono">{prov.model}</div>
          )}
        </div>
      </div>

      <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
        <Tooltip
          text={
            testStatus === "ok"
              ? "连接正常 · 重新测试"
              : testStatus === "err"
                ? "连接失败 · 重新测试"
                : "测试连接"
          }
        >
          <motion.button
            type="button"
            onClick={onTest}
            disabled={testStatus === "running"}
            // Failure shake — three small horizontal nudges, only on
            // the err pulse. Success path leaves the button still and
            // lets the ring carry the news. Driven by shakeControls
            // (see effect above) so the DOM node stays stable across
            // retries — `key`-based remount drops keyboard focus.
            animate={shakeControls}
            className="relative h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors disabled:opacity-50"
            aria-label={`测试 ${name} 的连接`}
          >
            {/* Success ring pulse — radial accent fading from 0.7 -> 0
                as it scales out. Only paints on each fresh "ok" via
                resultPulseKey so re-tests replay the cue. */}
            <AnimatePresence>
              {testStatus === "ok" && !reducedMotion && (
                <motion.span
                  key={`ok-pulse-${resultPulseKey}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-md"
                  initial={{ opacity: 0.75, scale: 0.7 }}
                  animate={{ opacity: 0, scale: 1.6 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    background:
                      "radial-gradient(circle at center, var(--status-ok-25), transparent 70%)",
                    boxShadow: "0 0 0 1px var(--status-ok-25)",
                  }}
                />
              )}
            </AnimatePresence>
            {/* Status icon swap — mode="wait" so each glyph plays its
                own enter after the previous one finishes its exit;
                avoids two icons overlapping mid-transition. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={testStatus ?? "idle"}
                initial={
                  reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.6 }
                }
                animate={{ opacity: 1, scale: 1 }}
                exit={
                  reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }
                }
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-10 inline-flex"
              >
                {testStatus === "running" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : testStatus === "ok" ? (
                  <Check size={14} className="text-[color:var(--status-ok)]" />
                ) : testStatus === "err" ? (
                  <X size={14} className="text-[color:var(--status-err)]" />
                ) : (
                  <Play size={13} />
                )}
              </motion.span>
            </AnimatePresence>
          </motion.button>
        </Tooltip>
        <Tooltip text="编辑凭证">
          <button
            type="button"
            onClick={onEdit}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-foreground hover:bg-[color:var(--w-06)] transition-colors"
            aria-label={`编辑 ${name}`}
          >
            <Pencil size={13} />
          </button>
        </Tooltip>
        {!isDefault && (
          <Tooltip text="设为默认凭证">
            <Button size="sm" onClick={onUse}>
              使用
            </Button>
          </Tooltip>
        )}
        <Tooltip text="删除凭证">
          <button
            type="button"
            onClick={async () => {
              const ok = await confirm({
                title: `删除凭证「${name}」`,
                description: "此操作无法撤销。",
                confirmText: "删除",
                variant: "danger",
              });
              if (ok) onDelete();
            }}
            className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted hover:text-[color:var(--status-err)] hover:bg-[color:var(--status-err-10)] transition-colors"
            aria-label={`删除 ${name}`}
          >
            <Trash2 size={13} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

export function CredsPanel({ config }: { config?: ServerConfig }) {
  const providers = config?.providers ?? {};
  const names = Object.keys(providers);
  const effectiveDefault = effectiveDefaultProvider(config);
  const setDefault = useSetDefaultProvider();
  const deleteProv = useDeleteProvider();
  const test = useTestProvider();
  const reducedMotion = useReducedMotion();
  const [showAdd, setShowAdd] = useState(false);
  const [editingName, setEditingName] = useState<string | undefined>();
  const [testMap, setTestMap] = useState<
    Record<string, { status: "idle" | "running" | "ok" | "err" }>
  >({});

  const runTest = async (name: string) => {
    setTestMap((m) => ({ ...m, [name]: { status: "running" } }));
    try {
      const r = await test.mutateAsync(name);
      setTestMap((m) => ({
        ...m,
        [name]: { status: r.ok ? "ok" : "err" },
      }));
      if (r.ok)
        toast.success("连接正常", { description: `${name} 可以使用。` });
      else toast.error("连接失败", { description: r.message });
    } catch (e) {
      setTestMap((m) => ({ ...m, [name]: { status: "err" } }));
      toast.error("连接失败", { description: (e as Error).message });
    }
  };

  const makeDefault = async (name: string) => {
    try {
      await setDefault.mutateAsync(name);
      toast.success("默认凭证已更新", {
        description: `之后会优先使用 ${name}。`,
      });
    } catch (error) {
      toast.error("设置失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const removeProvider = async (name: string) => {
    try {
      await deleteProv.mutateAsync(name);
      toast.success("凭证已删除", { description: name });
    } catch (error) {
      toast.error("删除失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4 sm:p-5">
      {names.length === 0 ? (
        <Empty
          icon="providers"
          title="还没有配置凭证"
          subtitle="支持 OpenAI / Azure / 自定义供应商。"
          action={
            <Button
              variant="primary"
              size="md"
              icon="plus"
              onClick={() => setShowAdd(true)}
            >
              添加凭证
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {names.map((name) => (
              <motion.div
                key={name}
                layout="position"
                initial={
                  reducedMotion
                    ? false
                    : { opacity: 0, y: 6, scale: 0.98 }
                }
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.96, x: -12 }
                }
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <CredCard
                  name={name}
                  prov={providers[name]}
                  isDefault={name === effectiveDefault}
                  testStatus={testMap[name]?.status}
                  onEdit={() => setEditingName(name)}
                  onUse={() => makeDefault(name)}
                  onTest={() => runTest(name)}
                  onDelete={() => removeProvider(name)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {names.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="mt-3 w-full flex items-center justify-center gap-2 h-12 rounded-xl text-[13px] text-muted hover:text-foreground transition-colors"
          style={{
            background: "var(--w-02)",
            border: "1px dashed var(--w-16)",
          }}
        >
          <Plus size={15} />
          添加凭证
        </button>
      )}

      <AddProviderDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        existingNames={names}
      />
      <AddProviderDialog
        open={Boolean(editingName)}
        onOpenChange={(open) => {
          if (!open) setEditingName(undefined);
        }}
        existingNames={names}
        mode="edit"
        providerName={editingName}
        provider={editingName ? providers[editingName] : undefined}
      />
    </div>
  );
}
