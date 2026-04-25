import { type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icon";

export function Empty({
  icon,
  title,
  subtitle,
  action,
}: {
  icon?: IconName;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-10 text-center text-muted">
      {icon && (
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{
            background:
              "radial-gradient(120% 80% at 30% 30%, rgba(167,139,250,0.25), transparent 60%), rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow:
              "0 8px 24px -8px rgba(167,139,250,0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
            color: "var(--accent)",
          }}
        >
          <Icon name={icon} size={20} />
        </div>
      )}
      {title && <div className="t-h3 text-foreground">{title}</div>}
      {subtitle && <div className="t-small max-w-[340px]">{subtitle}</div>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
