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
    <div className="flex flex-col items-center justify-center gap-2.5 p-10 text-center text-muted">
      {icon && (
        <div className="w-11 h-11 rounded-[10px] bg-sunken border border-border flex items-center justify-center text-faint">
          <Icon name={icon} size={20} />
        </div>
      )}
      {title && <div className="t-h3 text-foreground">{title}</div>}
      {subtitle && <div className="t-small max-w-[340px]">{subtitle}</div>}
      {action && <div className="mt-1.5">{action}</div>}
    </div>
  );
}
