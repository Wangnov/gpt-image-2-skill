import { type CSSProperties } from "react";
import { cn } from "@/lib/cn";

export function Divider({ vertical, className, style }: { vertical?: boolean; className?: string; style?: CSSProperties }) {
  return vertical ? (
    <div className={cn("w-px self-stretch bg-border", className)} style={style} />
  ) : (
    <div className={cn("h-px w-full bg-border", className)} style={style} />
  );
}
