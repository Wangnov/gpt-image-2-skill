import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  monospace?: boolean;
  minHeight?: number;
};

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(
  ({ className, monospace, minHeight = 80, style, ...rest }, ref) => (
    <textarea
      ref={ref}
      style={{ minHeight, ...style }}
      className={cn(
        "w-full px-3 py-2.5 bg-raised border border-border rounded-md text-[13.5px] leading-[1.55] outline-none transition-colors focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-faint)] resize-y",
        monospace && "font-mono",
        className
      )}
      {...rest}
    />
  )
);

Textarea.displayName = "Textarea";
