import type { validateImageSize, validateOutputCount } from "@/lib/image-options";
import type { EditRegionMode } from "@/components/screens/edit/shared";

export type SizeValidation = ReturnType<typeof validateImageSize>;
export type OutputCountValidation = ReturnType<typeof validateOutputCount>;

export type ClassicEditOutput = {
  index: number;
  url: string;
  selected: boolean;
  seed: number;
};

export function regionModeHint(mode: EditRegionMode) {
  if (mode === "native-mask") return "遮罩会精确作用在目标图上。";
  if (mode === "reference-hint") {
    return "会额外发送一张选区标记图；用户上传图片顺序保持不变。";
  }
  return "请切换到多图参考，或换一个支持局部编辑的凭证。";
}
