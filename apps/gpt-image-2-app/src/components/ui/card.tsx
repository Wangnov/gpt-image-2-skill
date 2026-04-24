import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Props = HTMLAttributes<HTMLDivElement> & {
  elevated?: boolean;
  padding?: number;
};

export function Card({ elevated, padding = 16, className, style, children, ...rest }: Props) {
  return (
    <div
      className={cn("bg-raised border border-border rounded-lg", elevated && "shadow-md", className)}
      style={{ padding, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
