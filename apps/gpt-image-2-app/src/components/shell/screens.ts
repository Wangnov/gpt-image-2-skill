/**
 * Single source of truth for the four production screens.
 * Sidebar / providers / mockups have been retired — settings now
 * absorbs credential management as its first sub-page.
 */
import { t } from "@/lib/i18n";
export type ScreenId = "generate" | "edit" | "history" | "settings";

export const SCREENS: { id: ScreenId; label: string; kbd: string }[] = [
  {
    id: "generate",
    get label() {
      return t("生成");
    },
    kbd: "1",
  },
  {
    id: "edit",
    get label() {
      return t("编辑");
    },
    kbd: "2",
  },
  {
    id: "history",
    get label() {
      return t("任务");
    },
    kbd: "3",
  },
  {
    id: "settings",
    get label() {
      return t("设置");
    },
    kbd: "4",
  },
];

export function isScreenId(value: unknown): value is ScreenId {
  return (
    value === "generate" ||
    value === "edit" ||
    value === "history" ||
    value === "settings"
  );
}
