import * as Tip from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";

export function Tooltip({ text, children, delay = 120 }: { text: string; children: ReactNode; delay?: number }) {
  return (
    <Tip.Provider delayDuration={delay}>
      <Tip.Root>
        <Tip.Trigger asChild>{children}</Tip.Trigger>
        <Tip.Portal>
          <Tip.Content
            sideOffset={6}
            className="z-[100] bg-[color:var(--n-900)] text-white text-[11px] font-medium px-2 py-1 rounded animate-fade-in"
          >
            {text}
          </Tip.Content>
        </Tip.Portal>
      </Tip.Root>
    </Tip.Provider>
  );
}
