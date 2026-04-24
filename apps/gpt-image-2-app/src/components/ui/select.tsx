import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/icon";

type Option = string | { value: string; label: string };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  options: readonly Option[];
  size?: "sm" | "md" | "lg";
};

const heights = { sm: "h-7", md: "h-8", lg: "h-10" } as const;

export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ options, size = "md", className, style, ...rest }, ref) => {
    return (
      <div className={cn("relative inline-block w-full", heights[size])} style={style}>
        <select
          ref={ref}
          className={cn(
            "w-full h-full pl-2.5 pr-7 bg-raised border border-border rounded-md text-[13px] appearance-none cursor-pointer outline-none",
            className
          )}
          {...rest}
        >
          {options.map((o) =>
            typeof o === "string" ? (
              <option key={o} value={o}>{o}</option>
            ) : (
              <option key={o.value} value={o.value}>{o.label}</option>
            )
          )}
        </select>
        <Icon
          name="chevdown"
          size={14}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-faint)",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }
);

Select.displayName = "Select";
