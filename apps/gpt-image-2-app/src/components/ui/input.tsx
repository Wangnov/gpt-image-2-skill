import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";
import {
  useFieldDescribedBy,
  useFieldId,
  useFieldInvalid,
} from "@/lib/field-context";

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
  (
    {
      icon,
      suffix,
      size = "md",
      monospace,
      className,
      wrapperClassName,
      style,
      id: idProp,
      "aria-describedby": ariaDescribedByProp,
      "aria-invalid": ariaInvalidProp,
      ...rest
    },
    ref,
  ) => {
    const id = useFieldId(idProp);
    const describedBy = useFieldDescribedBy(
      typeof ariaDescribedByProp === "string" ? ariaDescribedByProp : undefined,
    );
    const invalid = useFieldInvalid(
      ariaInvalidProp === true || ariaInvalidProp === "true"
        ? true
        : ariaInvalidProp === false || ariaInvalidProp === "false"
          ? false
          : undefined,
    );

    return (
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 rounded-md transition-colors",
          "bg-[color:var(--w-04)] border border-border",
          "focus-within:border-[color:var(--accent-55)] focus-within:bg-[color:var(--accent-06)] focus-within:shadow-[0_0_0_3px_var(--accent-14)]",
          invalid &&
            "border-status-err focus-within:border-status-err focus-within:shadow-[0_0_0_3px_var(--status-err-18)]",
          heights[size],
          wrapperClassName,
        )}
        style={style}
      >
        {icon && (
          <Icon
            name={icon}
            size={14}
            style={{ color: "var(--text-faint)" }}
            aria-hidden="true"
          />
        )}
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={cn(
            "flex-1 bg-transparent border-none outline-none text-[13px] min-w-0 placeholder:text-faint",
            monospace && "font-mono",
            className,
          )}
          {...rest}
        />
        {suffix}
      </div>
    );
  },
);

Input.displayName = "Input";
