import { t } from "@/lib/i18n";
import { toast } from "sonner";

export async function copyText(value: string, label = t("已复制")) {
  await navigator.clipboard.writeText(value);
  toast.success(label);
}
