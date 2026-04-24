import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";

type InputSize = "sm" | "md" | "lg";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  icon?: IconName;
  suffix?: ReactNode;
  size?: InputSize;
  monospace?: boolean;
  wrapperClassName?: string;
};

const heights: Record<InputSize, string> = { sm: "h-7", md: "h-8", lg: "h-10" };

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ icon, suffix, size = "md", monospace, className, wrapperClassName, style, ...rest }, ref) => {
    return (
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 bg-raised border border-border rounded-md transition-colors focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--accent-faint)]",
          heights[size],
          wrapperClassName
        )}
        style={style}
      >
        {icon && <Icon name={icon} size={14} style={{ color: "var(--text-faint)" }} />}
        <input
          ref={ref}
          className={cn(
            "flex-1 bg-transparent border-none outline-none text-[13px] min-w-0",
            monospace && "font-mono",
            className
          )}
          {...rest}
        />
        {suffix}
      </div>
    );
  }
);

Input.displayName = "Input";
