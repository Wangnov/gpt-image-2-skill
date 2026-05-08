import type { IconName } from "@/components/icon";
import type { Job } from "@/lib/types";
import type { RuntimeKind } from "@/lib/api/types";

export type ImageActionId =
  | "copy-image"
  | "copy-prompt"
  | "copy-path-or-link"
  | "save-as"
  | "reveal-in-finder"
  | "open-with-default"
  | "use-as-reference"
  | "edit-with-prompt"
  | "reveal-job-in-history"
  | "quick-look"
  | "drag-out"
  | "share"
  | "delete";

export type ImageActionGroup =
  | "transfer"
  | "export"
  | "generate"
  | "manage"
  | "destructive";

export type ImageActionSurface =
  | "context-menu"
  | "hover-toolbar"
  | "command-palette";

export type ImageAsset = {
  jobId: string;
  outputIndex: number;
  src: string;
  path?: string | null;
  prompt?: string;
  command?: Job["command"];
  job?: Job;
};

export type ImageActionContext = {
  asset: ImageAsset;
  runtime: RuntimeKind;
  surface: ImageActionSurface;
};

export type ImageAction = {
  id: ImageActionId;
  label: (ctx: ImageActionContext) => string;
  shortLabel?: (ctx: ImageActionContext) => string;
  icon: IconName;
  shortcut?: string;
  group: ImageActionGroup;
  destructive?: boolean;
  isAvailable: (ctx: ImageActionContext) => boolean;
  isEnabled?: (ctx: ImageActionContext) => boolean;
  disabledReason?: (ctx: ImageActionContext) => string | undefined;
  execute: (ctx: ImageActionContext) => Promise<void> | void;
};
