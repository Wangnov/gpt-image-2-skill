import * as RadixDialog from "@radix-ui/react-dialog";
import { Image as ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutputTile } from "@/components/screens/shared/output-tile";
import { api } from "@/lib/api";
import { imageAssetFromOutput } from "@/lib/image-actions/asset";
import { sendImageToEdit } from "@/lib/job-navigation";
import type { runtimeCopy } from "@/lib/runtime-copy";
import { openPath, revealPath, saveImages } from "@/lib/user-actions";
import type { EditOutput } from "./shared";

type RuntimeCopy = ReturnType<typeof runtimeCopy>;

export function OutputDrawer({
  open,
  onOpenChange,
  isWorking,
  displayN,
  outputs,
  hasOutputs,
  copy,
  saveSelected,
  saveAll,
  selectedPath,
  jobId,
  prompt,
  setSelectedOutput,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isWorking: boolean;
  displayN: number;
  outputs: EditOutput[];
  hasOutputs: boolean;
  copy: RuntimeCopy;
  saveSelected: () => void;
  saveAll: () => void;
  selectedPath?: string;
  jobId: string | null;
  prompt: string;
  setSelectedOutput: (index: number) => void;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Trigger asChild>
        <button
          type="button"
          className="absolute right-5 -top-12 z-20 inline-flex h-9 items-center gap-2 rounded-full border border-[color:var(--accent-35)] px-3 text-[12px] font-semibold text-foreground shadow-floating backdrop-blur-xl transition-[background-color,opacity,transform] hover:-translate-y-0.5 hover:bg-[color:var(--w-09)]"
          style={{
            background:
              "linear-gradient(135deg, rgba(var(--accent-rgb), 0.2), rgba(var(--accent-2-rgb), 0.14)), var(--bg-raised)",
          }}
          aria-label="打开输出抽屉"
        >
          {isWorking ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ImageIcon size={13} />
          )}
          <span>
            {isWorking ? `生成中 · ${displayN} 张` : `输出 · ${outputs.length} 张`}
          </span>
        </button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          aria-hidden
        />
        <RadixDialog.Content
          className="fixed inset-x-4 bottom-4 z-50 grid max-h-[min(46vh,420px)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-border-faint shadow-popover outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-4"
          style={{
            background: "var(--surface-floating)",
            backdropFilter: "blur(28px) saturate(150%)",
            WebkitBackdropFilter: "blur(28px) saturate(150%)",
          }}
        >
          <div className="flex min-w-0 items-center gap-2 border-b border-[color:var(--w-06)] px-4 py-3">
            <RadixDialog.Title className="shrink-0 text-[13px] font-semibold text-foreground">
              {isWorking ? `生成中 · ${displayN} 张` : `输出 · ${outputs.length} 张`}
            </RadixDialog.Title>
            <div className="min-w-0 flex-1" />
            {hasOutputs && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="download"
                  onClick={saveSelected}
                >
                  {copy.saveSelectedLabel}
                </Button>
                {outputs.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="download"
                    onClick={saveAll}
                  >
                    {copy.saveJobLabel}
                  </Button>
                )}
                {api.canRevealFiles && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="folder"
                    onClick={() => revealPath(selectedPath)}
                  >
                    位置
                  </Button>
                )}
              </>
            )}
            <RadixDialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-[color:var(--w-06)] hover:text-foreground"
                aria-label="关闭输出抽屉"
              >
                <X size={14} />
              </button>
            </RadixDialog.Close>
          </div>
          <div className="min-h-0 overflow-x-auto overflow-y-hidden p-3 scrollbar-thin">
            <div className="flex min-w-max gap-2 pb-1">
              {isWorking &&
                !hasOutputs &&
                Array.from({ length: displayN }).map((_, i) => (
                  <div
                    key={i}
                    className="shrink-0 animate-fade-up"
                    style={{ animationDelay: `${i * 65}ms` }}
                  >
                    <div
                      className="flex h-20 w-20 items-center justify-center rounded-md border border-border bg-[color:var(--w-04)] font-mono text-[10px] text-faint animate-shimmer"
                      style={{
                        background: "var(--skeleton-gradient-soft)",
                        backgroundSize: "200% 100%",
                      }}
                    >
                      {String.fromCharCode(65 + i)}
                    </div>
                  </div>
                ))}
              {hasOutputs &&
                outputs.map((output) => {
                  if (!jobId) return null;
                  return (
                    <div
                      key={output.index}
                      className="w-20 shrink-0 animate-fade-up"
                      style={{ animationDelay: `${output.index * 45}ms` }}
                    >
                      <OutputTile
                        output={output}
                        asset={imageAssetFromOutput({
                          jobId,
                          outputIndex: output.index,
                          src: output.url ?? "",
                          path: api.outputPath(jobId, output.index) ?? null,
                          prompt: prompt || undefined,
                          command: "images edit",
                        })}
                        downloadLabel={copy.saveImageLabel}
                        onSelect={() => setSelectedOutput(output.index)}
                        onDownload={() =>
                          saveImages(
                            [api.outputPath(jobId, output.index)],
                            "图片",
                          )
                        }
                        onOpen={() => openPath(api.outputPath(jobId, output.index))}
                        onSendToEdit={() =>
                          sendImageToEdit({
                            jobId,
                            outputIndex: output.index,
                            path: api.outputPath(jobId, output.index),
                            url: output.url,
                          })
                        }
                      />
                    </div>
                  );
                })}
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
