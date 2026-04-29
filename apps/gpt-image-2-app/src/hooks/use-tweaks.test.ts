import { afterEach, describe, expect, it, vi } from "vitest";
import { __resolveInitialInterfaceModeForTests } from "./use-tweaks";

function installWindow(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("window", {
    ...overrides,
  });
}

describe("initial interface mode migration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps first-time users on the modern interface", () => {
    installWindow();

    expect(__resolveInitialInterfaceModeForTests(undefined)).toBe("modern");
  });

  it("moves older static page users to the classic interface", () => {
    installWindow();

    expect(__resolveInitialInterfaceModeForTests({ theme: "dark" })).toBe(
      "legacy",
    );
  });

  it("preserves explicit modern choices", () => {
    installWindow();

    expect(
      __resolveInitialInterfaceModeForTests({
        theme: "dark",
        interfaceMode: "modern",
      }),
    ).toBe("modern");
  });

  it("does not migrate the Tauri app", () => {
    installWindow({ __TAURI_INTERNALS__: {} });

    expect(__resolveInitialInterfaceModeForTests({ theme: "dark" })).toBe(
      "modern",
    );
  });

  it("does not migrate the HTTP web runtime", () => {
    installWindow({ __GPT_IMAGE_2_RUNTIME__: "http" });

    expect(__resolveInitialInterfaceModeForTests({ theme: "dark" })).toBe(
      "modern",
    );
  });
});
