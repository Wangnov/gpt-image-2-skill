import * as Tip from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";

export function Tooltip({
  text,
  children,
  delay = 120,
}: {
  text: string;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <Tip.Provider delayDuration={delay}>
      <Tip.Root>
        <Tip.Trigger asChild>{children}</Tip.Trigger>
        <Tip.Portal>
          <Tip.Content
            sideOffset={6}
            className="z-[100] text-foreground text-[11px] font-medium px-2.5 py-1.5 rounded-md animate-fade-in"
            style={{
              background: "var(--surface-floating-strong)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid var(--surface-floating-border)",
              boxShadow: "0 8px 24px var(--k-55)",
            }}
          >
            {text}
          </Tip.Content>
        </Tip.Portal>
      </Tip.Root>
    </Tip.Provider>
  );
}
