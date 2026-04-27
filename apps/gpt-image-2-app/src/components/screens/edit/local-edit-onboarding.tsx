import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

const STORAGE_KEY = "gpt2.onboarding.localedit";

/**
 * One-time onboarding card for the "局部编辑" edit mode.
 *
 * The concept ("目标图" receives the mask while other refs only carry
 * style / person / object hints) isn't obvious from the toolbar alone — the
 * popover tooltip is too quiet and shows up after the user has already
 * uploaded an image. This dialog surfaces the model the first time the user
 * lands on the mode, then sticks "dismissed" in localStorage so it never
 * comes back.
 */
export function LocalEditOnboarding({ active }: { active: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!active) return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      /* ignore — private mode etc. */
    }
    setOpen(true);
  }, [active]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) dismiss();
      }}
      title="局部编辑模式"
      width={520}
      footer={
        <Button variant="primary" size="sm" onClick={dismiss}>
          我懂了
        </Button>
      }
    >
      <div className="space-y-4 text-[13px]">
        <p className="text-muted leading-relaxed">
          这个模式只重画图片的某一区域,其他参考图只为风格 / 人物 / 物体提供线索。
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-[color:var(--accent-30)] bg-[color:var(--accent-08)] p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <Icon
                name="mask"
                size={14}
                style={{ color: "var(--accent)" }}
              />
              <span className="font-semibold">目标图</span>
            </div>
            <p className="text-[12px] text-muted leading-relaxed">
              在它上面涂遮罩。AI 只重画涂掉的部分,其他像素保持原样。每次只能有一个目标图。
            </p>
          </div>
          <div className="rounded-lg border border-border bg-[color:var(--w-04)] p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <Icon
                name="image"
                size={14}
                className="text-foreground opacity-80"
              />
              <span className="font-semibold">参考图</span>
            </div>
            <p className="text-[12px] text-muted leading-relaxed">
              为目标图提供风格 / 人物 / 物体的视觉线索。AI 不会改写这些图本身。
            </p>
          </div>
        </div>
        <p className="t-tiny pt-1">
          切换回「多图参考」可以用同一组图按多张参考自由拼合。
        </p>
      </div>
    </Dialog>
  );
}
