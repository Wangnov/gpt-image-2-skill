import { useEffect, useState } from "react";
import * as Radix from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { RevealImage } from "@/components/ui/reveal-image";
import { ImageContextMenu } from "@/components/ui/image-context-menu";
import { cn } from "@/lib/cn";
import type { ImageAsset } from "@/lib/image-actions/types";

export type QuickLookPayload = {
  asset: ImageAsset;
  /**
   * Optional sibling images (e.g. multi-output edit results). When provided,
   * left/right arrow buttons + a thumbnail strip + ArrowLeft/ArrowRight
   * keyboard shortcuts navigate among them.
   */
  peers?: ImageAsset[];
  /**
   * Called when the user navigates to a different peer. The host updates its
   * own focused asset to match.
   */
  onChange?: (next: ImageAsset) => void;
};

type Listener = (payload: QuickLookPayload) => void;
let openListener: Listener | null = null;

/**
 * Imperatively open the Quick Look overlay. Used by:
 *   - Space key from `useImageShortcuts` (single asset, no peers)
 *   - Detail drawer "click big image" path (peers + onChange)
 *   - Hover toolbar Quick Look icon (single asset)
 *
 * No-op if `<QuickLookHost />` isn't mounted yet (e.g. during early boot).
 */
export function openQuickLook(payload: QuickLookPayload) {
  openListener?.(payload);
}

/**
 * Mount once at app root. Renders a fullscreen Radix Dialog backing the
 * Quick Look UX, identical visual style to the detail drawer's previous
 * inline zoom dialog (which is removed in this commit).
 *
 * Esc closes (Radix default). Arrow keys navigate when peers are provided.
 */
export function QuickLookHost() {
  const [state, setState] = useState<QuickLookPayload | null>(null);
  const open = state != null;

  useEffect(() => {
    openListener = setState;
    return () => {
      if (openListener === setState) openListener = null;
    };
  }, []);

  useEffect(() => {
    if (!open || !state) return;
    if (!state.peers || state.peers.length <= 1) return;
    const peers = state.peers;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const idx = peers.findIndex(
        (p) =>
          p.jobId === state.asset.jobId &&
          p.outputIndex === state.asset.outputIndex,
      );
      if (idx < 0) return;
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = peers[(idx + delta + peers.length) % peers.length];
      state.onChange?.(next);
      setState({ ...state, asset: next });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, state]);

  if (!open || !state) return null;

  const { asset, peers, onChange } = state;
  const peerCount = peers?.length ?? 0;
  const activePosition =
    peers?.findIndex(
      (p) =>
        p.jobId === asset.jobId && p.outputIndex === asset.outputIndex,
    ) ?? -1;

  const goPrev = () => {
    if (!peers || peers.length <= 1) return;
    const next = peers[(activePosition - 1 + peers.length) % peers.length];
    onChange?.(next);
    setState({ ...state, asset: next });
  };
  const goNext = () => {
    if (!peers || peers.length <= 1) return;
    const next = peers[(activePosition + 1) % peers.length];
    onChange?.(next);
    setState({ ...state, asset: next });
  };

  return (
    <Radix.Root open onOpenChange={(o) => !o && setState(null)}>
      <Radix.Portal>
        <Radix.Overlay
          className="fixed inset-0 z-[60] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          style={{
            background: "var(--k-70)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        />
        <Radix.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[61] -translate-x-1/2 -translate-y-1/2 max-w-[92vw] max-h-[92vh] outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95"
        >
          <Radix.Title className="sr-only">作品详情</Radix.Title>
          <ImageContextMenu asset={asset}>
            <RevealImage
              src={asset.src}
              alt="作品详情"
              decoding="async"
              duration={500}
              className="block max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-[var(--shadow-floating)]"
            />
          </ImageContextMenu>
          {peerCount > 1 ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="上一张"
                className="absolute left-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--surface-floating-border)] bg-[color:var(--surface-floating)] text-foreground backdrop-blur transition-colors hover:bg-[color:var(--surface-floating-strong)]"
                style={{ boxShadow: "var(--shadow-floating)" }}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="下一张"
                className="absolute right-3 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--surface-floating-border)] bg-[color:var(--surface-floating)] text-foreground backdrop-blur transition-colors hover:bg-[color:var(--surface-floating-strong)]"
                style={{ boxShadow: "var(--shadow-floating)" }}
              >
                <ChevronRight size={20} />
              </button>
              <div className="absolute bottom-3 left-1/2 flex max-w-[78vw] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-full border border-[color:var(--surface-floating-border)] bg-[color:var(--surface-floating)] p-1.5 backdrop-blur scrollbar-none">
                {peers!.map((peer, i) => {
                  const isActive =
                    peer.jobId === asset.jobId &&
                    peer.outputIndex === asset.outputIndex;
                  return (
                    <button
                      key={`${peer.jobId}-${peer.outputIndex}`}
                      type="button"
                      onClick={() => {
                        onChange?.(peer);
                        setState({ ...state, asset: peer });
                      }}
                      className={cn(
                        "h-10 w-10 shrink-0 overflow-hidden rounded-full border transition-all",
                        isActive
                          ? "border-[color:var(--accent)] opacity-100"
                          : "border-transparent opacity-55 hover:opacity-90",
                      )}
                      aria-label={`切换到第 ${i + 1} 张`}
                    >
                      <img
                        src={peer.src}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          <Radix.Close asChild>
            <button
              type="button"
              aria-label="关闭"
              className="absolute -top-2 -right-2 h-9 w-9 rounded-full inline-flex items-center justify-center bg-[color:var(--surface-floating)] backdrop-blur border border-[color:var(--surface-floating-border)] text-foreground hover:bg-[color:var(--surface-floating-strong)] transition-colors"
              style={{ boxShadow: "var(--shadow-floating)" }}
            >
              <X size={16} />
            </button>
          </Radix.Close>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
