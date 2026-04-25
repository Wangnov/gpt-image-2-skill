import { type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Props = HTMLAttributes<HTMLDivElement> & {
  elevated?: boolean;
  padding?: number;
};

/**
 * Glass card surface — used widely across screens.
 * Picks up backdrop-blur from .surface-panel via the same token system.
 */
export function Card({
  elevated,
  padding = 16,
  className,
  style,
  children,
  ...rest
}: Props) {
  return (
    <div
      className={cn("surface-panel", elevated && "shadow-md", className)}
      style={{ padding, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
