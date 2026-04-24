import { type ReactNode } from "react";

export function FieldLabel({
  children,
  hint,
  kbd,
  inline,
}: {
  children: ReactNode;
  hint?: ReactNode;
  kbd?: ReactNode;
  inline?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 ${inline ? "justify-start" : "justify-between"} ${inline ? "" : "mb-1.5"}`}
    >
      <span className="text-[12px] font-semibold text-foreground">{children}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
      {kbd && <span className="kbd">{kbd}</span>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col mb-3.5">
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </div>
  );
}
