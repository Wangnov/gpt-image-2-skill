import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/icon";
import {
  useFieldDescribedBy,
  useFieldId,
  useFieldInvalid,
} from "@/lib/field-context";

type Option = string | { value: string; label: string };

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  options: readonly Option[];
  size?: "sm" | "md" | "lg";
};

const heights = { sm: "h-7", md: "h-8", lg: "h-10" } as const;

export const Select = forwardRef<HTMLSelectElement, Props>(
  (
    {
      options,
      size = "md",
      className,
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
        className={cn("relative inline-block w-full", heights[size])}
        style={style}
      >
        <select
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={cn(
            "h-full w-full cursor-pointer appearance-none rounded-md border border-border bg-raised pl-2.5 pr-7 text-[13px] outline-none transition-colors focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-faint)]",
            invalid && "border-status-err focus:border-status-err",
            className,
          )}
          {...rest}
        >
          {options.map((o) =>
            typeof o === "string" ? (
              <option key={o} value={o}>
                {o}
              </option>
            ) : (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ),
          )}
        </select>
        <Icon
          name="chevdown"
          size={14}
          aria-hidden="true"
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
  },
);

Select.displayName = "Select";
