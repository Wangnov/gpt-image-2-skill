import { type ReactNode } from "react";

export function WindowChrome({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full overflow-hidden bg-background">
      {children}
    </div>
  );
}
