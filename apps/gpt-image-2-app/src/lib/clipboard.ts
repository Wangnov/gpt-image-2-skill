import { toast } from "sonner";

export async function copyText(value: string, label = "已复制") {
  await navigator.clipboard.writeText(value);
  toast.success(label);
}
