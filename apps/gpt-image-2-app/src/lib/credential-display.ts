import { t } from "@/lib/i18n";
import type { CredentialRef } from "./types";

export function maskKey(value: string) {
  if (!value) return "—";
  if (value.length <= 8) return value.replace(/.(?=.{3})/g, "•");
  return `${value.slice(0, 3)}${"•".repeat(12)}${value.slice(-4)}`;
}

export function credentialSecretDisplay(credential?: CredentialRef | null) {
  if (!credential) return null;
  if (typeof credential.value === "string" && credential.value) {
    return maskKey(credential.value);
  }
  if (credential.present) {
    return t("已保存");
  }
  return null;
}
