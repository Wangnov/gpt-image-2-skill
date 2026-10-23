import { t } from "@/lib/i18n";
import { Icon, type IconName } from "@/components/icon";
import type { CredentialSource } from "@/lib/types";

const map: Record<CredentialSource, { icon: IconName; label: string }> = {
  file: {
    icon: "filedot",
    get label() {
      return t("配置文件");
    },
  },
  env: {
    icon: "envkey",
    get label() {
      return t("环境变量");
    },
  },
  keychain: {
    icon: "keychain",
    get label() {
      return t("钥匙串");
    },
  },
};

export function SourceChip({
  source,
  size = "sm",
}: {
  source: CredentialSource;
  size?: "sm" | "md";
}) {
  const m = map[source];
  const h = size === "sm" ? "h-[18px]" : "h-[22px]";
  return (
    <span
      className={`inline-flex items-center gap-1 ${h} px-1.5 text-[10.5px] text-muted bg-sunken border border-border rounded-[3px]`}
    >
      <Icon name={m.icon} size={11} />
      {m.label}
    </span>
  );
}
