import { t } from "@/lib/i18n";
export type PromptTemplateScope = "common" | "generate" | "edit" | "region";

export const PROMPT_TEMPLATE_ICONS = [
  {
    value: "sparkle",
    get label() {
      return t("灵感");
    },
  },
  {
    value: "wand",
    get label() {
      return t("魔法");
    },
  },
  {
    value: "image",
    get label() {
      return t("图像");
    },
  },
  {
    value: "camera",
    get label() {
      return t("摄影");
    },
  },
  {
    value: "portrait",
    get label() {
      return t("人像");
    },
  },
  {
    value: "landscape",
    get label() {
      return t("风景");
    },
  },
  {
    value: "palette",
    get label() {
      return t("配色");
    },
  },
  {
    value: "brush",
    get label() {
      return t("绘制");
    },
  },
  {
    value: "edit",
    get label() {
      return t("精修");
    },
  },
  {
    value: "mask",
    get label() {
      return t("选区");
    },
  },
  {
    value: "frame",
    get label() {
      return t("构图");
    },
  },
  {
    value: "cutout",
    get label() {
      return t("抠图");
    },
  },
  {
    value: "product",
    get label() {
      return t("产品");
    },
  },
  {
    value: "text",
    get label() {
      return t("文字");
    },
  },
  {
    value: "light",
    get label() {
      return t("光线");
    },
  },
  {
    value: "cinematic",
    get label() {
      return t("电影");
    },
  },
  {
    value: "sticker",
    get label() {
      return t("贴纸");
    },
  },
  {
    value: "layout",
    get label() {
      return t("版式");
    },
  },
  {
    value: "cube",
    get label() {
      return t("立体");
    },
  },
  {
    value: "pen",
    get label() {
      return t("文案");
    },
  },
  {
    value: "style",
    get label() {
      return t("风格");
    },
  },
  {
    value: "gallery",
    get label() {
      return t("图库");
    },
  },
  {
    value: "organize",
    get label() {
      return t("整理");
    },
  },
  {
    value: "generate",
    get label() {
      return t("生成");
    },
  },
  {
    value: "sun",
    get label() {
      return t("日光");
    },
  },
  {
    value: "circle",
    get label() {
      return t("通用");
    },
  },
] as const;

export const PROMPT_TEMPLATE_COLORS = [
  {
    value: "accent",
    get label() {
      return t("主题");
    },
  },
  {
    value: "cyan",
    get label() {
      return t("青");
    },
  },
  {
    value: "violet",
    get label() {
      return t("紫");
    },
  },
  {
    value: "emerald",
    get label() {
      return t("绿");
    },
  },
  {
    value: "amber",
    get label() {
      return t("橙");
    },
  },
  {
    value: "rose",
    get label() {
      return t("玫");
    },
  },
  {
    value: "slate",
    get label() {
      return t("灰");
    },
  },
] as const;

export type PromptTemplateIcon =
  (typeof PROMPT_TEMPLATE_ICONS)[number]["value"];
export type PromptTemplateColor =
  (typeof PROMPT_TEMPLATE_COLORS)[number]["value"];

export type PromptTemplateGroup = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type PromptTemplate = {
  id: string;
  groupId: string;
  title: string;
  prompt: string;
  scope: PromptTemplateScope;
  icon: PromptTemplateIcon;
  color: PromptTemplateColor;
  createdAt: number;
  updatedAt: number;
  usedAt?: number;
};

export type PromptTemplateState = {
  version: 1;
  groups: PromptTemplateGroup[];
  templates: PromptTemplate[];
};

export type PromptInsertResult = {
  value: string;
  cursor: number;
};

const STORAGE_KEY = "gpt2.promptTemplates";
export const PROMPT_TEMPLATES_EVENT = "gpt2:promptTemplates";
export const DEFAULT_PROMPT_TEMPLATE_ICON: PromptTemplateIcon = "sparkle";
export const DEFAULT_PROMPT_TEMPLATE_COLOR: PromptTemplateColor = "accent";

export const PROMPT_SCOPE_LABEL: Record<PromptTemplateScope, string> = {
  get common() {
    return t("通用");
  },
  get generate() {
    return t("生成");
  },
  get edit() {
    return t("编辑");
  },
  get region() {
    return t("局部编辑");
  },
};

const DEFAULT_GROUP_ID = "sample-group";
const DEFAULT_NOW = 1_700_000_000_000;

function uid(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function newPromptTemplateGroup(
  name = t("新分组"),
): PromptTemplateGroup {
  const now = Date.now();
  return {
    id: uid("group"),
    name,
    createdAt: now,
    updatedAt: now,
  };
}

export function newPromptTemplate(
  groupId: string,
  scope: PromptTemplateScope = "common",
): PromptTemplate {
  const now = Date.now();
  return {
    id: uid("template"),
    groupId,
    title: t("新模板"),
    prompt: "",
    scope,
    icon: DEFAULT_PROMPT_TEMPLATE_ICON,
    color: DEFAULT_PROMPT_TEMPLATE_COLOR,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultPromptTemplateState(): PromptTemplateState {
  return {
    version: 1,
    groups: [
      {
        id: DEFAULT_GROUP_ID,
        name: t("默认"),
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
    ],
    templates: [
      {
        id: "sample-product-photo",
        groupId: DEFAULT_GROUP_ID,
        title: t("产品摄影"),
        prompt: t(
          "产品摄影：主体清晰的产品，纯白背景，柔光，居中构图，高清细节",
        ),
        scope: "generate",
        icon: "image",
        color: "cyan",
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
      {
        id: "sample-edit-polish",
        groupId: DEFAULT_GROUP_ID,
        title: t("局部精修"),
        prompt: t(
          "保持整体风格不变，只优化选区细节，让材质更自然、边缘更干净。",
        ),
        scope: "region",
        icon: "brush",
        color: "violet",
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
      {
        id: "sample-style-note",
        groupId: DEFAULT_GROUP_ID,
        title: t("通用质感"),
        prompt: t("电影级光线，真实材质，清晰层次，避免过度锐化。"),
        scope: "common",
        icon: "sparkle",
        color: "accent",
        createdAt: DEFAULT_NOW,
        updatedAt: DEFAULT_NOW,
      },
    ],
  };
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readTime(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function isPromptTemplateScope(
  value: unknown,
): value is PromptTemplateScope {
  return (
    value === "common" ||
    value === "generate" ||
    value === "edit" ||
    value === "region"
  );
}

export function isPromptTemplateIcon(
  value: unknown,
): value is PromptTemplateIcon {
  return (
    typeof value === "string" &&
    PROMPT_TEMPLATE_ICONS.some((icon) => icon.value === value)
  );
}

function normalizePromptTemplateIcon(value: unknown): PromptTemplateIcon {
  if (isPromptTemplateIcon(value)) return value;
  if (value === "folder") return "organize";
  return DEFAULT_PROMPT_TEMPLATE_ICON;
}

export function isPromptTemplateColor(
  value: unknown,
): value is PromptTemplateColor {
  return (
    typeof value === "string" &&
    PROMPT_TEMPLATE_COLORS.some((color) => color.value === value)
  );
}

export function normalizePromptTemplateState(
  value: unknown,
): PromptTemplateState {
  const now = Date.now();
  if (!value || typeof value !== "object") {
    return defaultPromptTemplateState();
  }
  const input = value as Partial<PromptTemplateState>;
  const groups = Array.isArray(input.groups)
    ? input.groups
        .map((group, index): PromptTemplateGroup | null => {
          if (!group || typeof group !== "object") return null;
          const raw = group as Partial<PromptTemplateGroup>;
          const id = readString(raw.id, `group-${index}`);
          const createdAt = readTime(raw.createdAt, now);
          const updatedAt = readTime(raw.updatedAt, now);
          const name = readString(raw.name, t("未命名分组"));
          const migratedName =
            id === DEFAULT_GROUP_ID &&
            createdAt === DEFAULT_NOW &&
            name === "示例"
              ? t("默认")
              : name;
          return {
            id,
            name: migratedName,
            createdAt,
            updatedAt,
          };
        })
        .filter((group): group is PromptTemplateGroup => Boolean(group))
    : [];
  const dedupedGroups = groups.filter(
    (group, index, all) =>
      all.findIndex((item) => item.id === group.id) === index,
  );
  const hasInputTemplates =
    Array.isArray(input.templates) && input.templates.length > 0;
  const fallbackGroup =
    dedupedGroups[0] ??
    (hasInputTemplates ? newPromptTemplateGroup(t("默认")) : null);
  const groupIds = new Set(dedupedGroups.map((group) => group.id));
  if (dedupedGroups.length === 0 && fallbackGroup) {
    dedupedGroups.push(fallbackGroup);
    groupIds.add(fallbackGroup.id);
  }
  const templates = Array.isArray(input.templates)
    ? input.templates
        .map((template, index): PromptTemplate | null => {
          if (!template || typeof template !== "object") return null;
          const raw = template as Partial<PromptTemplate>;
          const scope = isPromptTemplateScope(raw.scope) ? raw.scope : "common";
          const icon = normalizePromptTemplateIcon(raw.icon);
          const color = isPromptTemplateColor(raw.color)
            ? raw.color
            : DEFAULT_PROMPT_TEMPLATE_COLOR;
          const groupId =
            typeof raw.groupId === "string" && groupIds.has(raw.groupId)
              ? raw.groupId
              : fallbackGroup?.id;
          if (!groupId) return null;
          return {
            id: readString(raw.id, `template-${index}`),
            groupId,
            title: readString(raw.title, t("未命名模板")),
            prompt: typeof raw.prompt === "string" ? raw.prompt : "",
            scope,
            icon,
            color,
            createdAt: readTime(raw.createdAt, now),
            updatedAt: readTime(raw.updatedAt, now),
            usedAt: readTime(raw.usedAt, 0) || undefined,
          };
        })
        .filter((template): template is PromptTemplate => Boolean(template))
    : [];
  return {
    version: 1,
    groups: dedupedGroups,
    templates: templates.filter(
      (template, index, all) =>
        all.findIndex((item) => item.id === template.id) === index,
    ),
  };
}

export function loadPromptTemplates(): PromptTemplateState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPromptTemplateState();
    return normalizePromptTemplateState(JSON.parse(raw));
  } catch {
    return defaultPromptTemplateState();
  }
}

export function savePromptTemplates(state: PromptTemplateState) {
  const normalized = normalizePromptTemplateState(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(PROMPT_TEMPLATES_EVENT));
  return normalized;
}

export function exportPromptTemplates(state: PromptTemplateState) {
  return JSON.stringify(normalizePromptTemplateState(state), null, 2);
}

export function importPromptTemplates(json: string): PromptTemplateState {
  return normalizePromptTemplateState(JSON.parse(json));
}

export function promptTemplateMatchesScope(
  templateScope: PromptTemplateScope,
  currentScope: PromptTemplateScope,
) {
  if (templateScope === "common" || templateScope === currentScope) return true;
  return currentScope === "region" && templateScope === "edit";
}

export function visiblePromptTemplatesForScope(
  state: PromptTemplateState,
  scope: PromptTemplateScope,
) {
  return state.templates
    .filter((template) => promptTemplateMatchesScope(template.scope, scope))
    .slice()
    .sort((a, b) => {
      const used = (b.usedAt ?? 0) - (a.usedAt ?? 0);
      if (used !== 0) return used;
      return b.updatedAt - a.updatedAt;
    });
}

export function insertPromptAtCursor(
  value: string,
  insert: string,
  selectionStart?: number | null,
  selectionEnd?: number | null,
): PromptInsertResult {
  const start =
    typeof selectionStart === "number"
      ? Math.max(0, selectionStart)
      : value.length;
  const end =
    typeof selectionEnd === "number" ? Math.max(start, selectionEnd) : start;
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  return {
    value: next,
    cursor: start + insert.length,
  };
}
