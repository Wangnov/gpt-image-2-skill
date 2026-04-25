import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import {
  useFieldDescribedBy,
  useFieldId,
  useFieldInvalid,
} from "@/lib/field-context";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  monospace?: boolean;
  minHeight?: number;
};

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(
  (
    {
      className,
      monospace,
      minHeight = 80,
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
      <textarea
        ref={ref}
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        style={{ minHeight, ...style }}
        className={cn(
          "w-full px-3.5 py-3 rounded-md text-[13.5px] leading-[1.55] outline-none transition-colors resize-y",
          "bg-[rgba(255,255,255,0.04)] border border-border placeholder:text-faint",
          "focus:border-[rgba(167,139,250,0.55)] focus:bg-[rgba(167,139,250,0.06)] focus:shadow-[0_0_0_3px_rgba(167,139,250,0.14)]",
          invalid &&
            "border-status-err focus:border-status-err focus:shadow-[0_0_0_3px_rgba(248,113,113,0.18)]",
          monospace && "font-mono",
          className,
        )}
        {...rest}
      />
    );
  },
);

Textarea.displayName = "Textarea";
