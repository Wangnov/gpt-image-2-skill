import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import ts from "typescript";
import { english } from "./messages/en";

let language: typeof import("./i18n");
let storage: Map<string, string>;
let storageEvent: ((event: { key: string | null }) => void) | undefined;

beforeEach(async () => {
  vi.resetModules();
  storage = new Map();
  storageEvent = undefined;
  vi.stubGlobal("navigator", {
    language: "en-US",
    languages: ["en-US", "zh-CN"],
  });
  vi.stubGlobal("document", { documentElement: { lang: "" } });
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    addEventListener: (name: string, listener: typeof storageEvent) => {
      if (name === "storage") storageEvent = listener;
    },
  });
  language = await import("./i18n");
});

afterEach(() => vi.unstubAllGlobals());

describe("interface language", () => {
  it.each([
    ["zh_CN.UTF-8", "zh-CN"],
    ["zh-Hant-TW", "zh-CN"],
    [" ZH_cn ", "zh-CN"],
    ["zh", "zh-CN"],
    ["en_US.UTF-8", "en"],
    ["fr-FR", "en"],
    ["C", "en"],
    ["POSIX", "en"],
    [undefined, "en"],
  ])("resolves system locale %s to %s", (locale, expected) => {
    expect(language.languageFromLocale(locale)).toBe(expected);
  });

  it("uses the native message locale first, with explicit choices overriding it", () => {
    expect(language.resolveLanguage("auto", "C", "zh-CN")).toBe("en");
    expect(language.resolveLanguage("auto", "zh_CN.UTF-8", "en-US")).toBe(
      "zh-CN",
    );
    expect(language.resolveLanguage("auto", " ", "zh-Hant")).toBe("zh-CN");
    expect(language.resolveLanguage("en", "zh_CN.UTF-8", "zh-CN")).toBe("en");
    expect(language.resolveLanguage("zh-CN", "en_US.UTF-8", "en-US")).toBe(
      "zh-CN",
    );
  });

  it("uses the primary browser language, rather than a secondary Chinese preference", () => {
    language.initializeLanguage();
    expect(language.getLocale()).toBe("en");
    vi.stubGlobal("navigator", {
      language: "zh-CN",
      languages: ["zh-CN", "en"],
    });
    language.initializeLanguage();
    expect(language.getLocale()).toBe("zh-CN");
  });

  it("persists manual selection, restores System, and emits only actual changes", () => {
    language.initializeLanguage("en_US.UTF-8");
    const initial = language.getLanguageSnapshot();
    const listener = vi.fn();
    const unsubscribe = language.subscribeLanguage(listener);
    language.setLanguagePreference("auto");
    expect(language.getLanguageSnapshot()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    language.setLanguagePreference("zh-CN");
    expect(storage.get("gpt2.language")).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    language.initializeLanguage("en_US.UTF-8");
    expect(language.getLocale()).toBe("zh-CN");
    language.setLanguagePreference("auto");
    expect(language.getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    language.setLanguagePreference("zh-CN");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("updates an open tab when another tab changes or clears the preference", () => {
    language.initializeLanguage();
    storage.set("gpt2.language", "zh-CN");
    storageEvent?.({ key: "gpt2.language" });
    expect(language.getLocale()).toBe("zh-CN");
    storage.clear();
    storageEvent?.({ key: null });
    expect(language.getLanguageSnapshot()).toEqual({
      preference: "auto",
      locale: "en",
    });
  });

  it("allows switching when local storage is blocked", () => {
    Object.defineProperty(window, "localStorage", {
      get: () => {
        throw new Error("blocked");
      },
    });
    language.initializeLanguage("zh_CN.UTF-8");
    language.setLanguagePreference("en");
    expect(language.getLocale()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("translates catalog text while preserving names, prompts, paths, and placeholder-looking input", () => {
    language.setLanguagePreference("en");
    const userText = "中文用户内容/{p1}/<strong>";
    const values = { p0: userText };
    const result = language.t("存储目标「{p0}」不存在。", values);
    expect(result).toBe(`Storage target "${userText}" does not exist.`);
    expect(values).toEqual({ p0: userText });
    language.setLanguagePreference("zh-CN");
    expect(language.t("存储目标「{p0}」不存在。", values)).toBe(
      `存储目标「${userText}」不存在。`,
    );
  });

  it("uses singular catalog nouns without altering interpolated user content", () => {
    language.setLanguagePreference("en");
    expect(language.t("最多上传 {p0} 张。", { p0: 1 })).toBe(
      "You can upload up to 1 image.",
    );
    expect(language.t("最多上传 {p0} 张。", { p0: 2 })).toBe(
      "You can upload up to 2 images.",
    );
    expect(language.t("最多上传 {p0} 张。", { p0: "中文 images" })).toBe(
      "You can upload up to 中文 images images.",
    );
  });

  it("keeps translated registries live without changing stored IDs or theme parameters", async () => {
    const { SCREENS } = await import("@/components/shell/screens");
    const { THEME_PRESETS } = await import("./theme-presets");
    const { statusLabel } = await import("./format");
    const ids = SCREENS.map((screen) => screen.id);
    const background = { ...THEME_PRESETS["logo-grainient"].background };
    language.setLanguagePreference("en");
    expect(SCREENS.map((screen) => screen.label)).toEqual([
      "Generate",
      "Edit",
      "Tasks",
      "Settings",
    ]);
    expect(statusLabel("completed")).toBe("Completed");
    expect(THEME_PRESETS["logo-grainient"].displayName).not.toMatch(
      /[\u3400-\u9fff]/,
    );
    language.setLanguagePreference("zh-CN");
    expect(SCREENS.map((screen) => screen.label)).toEqual([
      "生成",
      "编辑",
      "任务",
      "设置",
    ]);
    expect(statusLabel("completed")).toBe("已完成");
    expect(THEME_PRESETS["logo-grainient"].displayName).toBe("彩晶雾");
    expect(SCREENS.map((screen) => screen.id)).toEqual(ids);
    expect(THEME_PRESETS["logo-grainient"].background).toEqual(background);
  });
});

describe("English message coverage", () => {
  it("covers every literal translation call and keeps interpolation parameters intact", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const missing = new Set<string>();
    let checked = 0;
    function inspect(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) inspect(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          const source = ts.createSourceFile(
            path,
            readFileSync(path, "utf8"),
            ts.ScriptTarget.Latest,
            true,
          );
          function visit(node: ts.Node) {
            if (
              ts.isCallExpression(node) &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === "t"
            ) {
              const first = node.arguments[0];
              if (first && ts.isStringLiteral(first)) {
                checked++;
                if (!(first.text in english)) missing.add(first.text);
              }
            }
            ts.forEachChild(node, visit);
          }
          visit(source);
        }
      }
    }
    inspect(root);
    expect(checked).toBeGreaterThan(1000);
    expect([...missing]).toEqual([]);
    const placeholders = (message: string) =>
      [...message.matchAll(/\{p\d+\}/g)].map((match) => match[0]).sort();
    for (const [source, translation] of Object.entries(english)) {
      expect(placeholders(translation), source).toEqual(placeholders(source));
      if (source !== "简体中文")
        expect(translation, source).not.toMatch(/[\u3400-\u9fff]/);
    }
  });
});
