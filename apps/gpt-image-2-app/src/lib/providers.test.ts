import { describe, expect, it } from "vitest";
import { defaultPathConfig, defaultStorageConfig } from "./api/shared";
import {
  effectiveDefaultProvider,
  reconcileProviderSelection,
} from "./providers";
import type { ServerConfig } from "./types";

function config(defaultProvider: string): ServerConfig {
  return {
    version: 1,
    default_provider: defaultProvider,
    providers: {
      first: {
        type: "openai-compatible",
        credentials: {},
      },
      second: {
        type: "openai-compatible",
        credentials: {},
      },
      disabled: {
        type: "openai-compatible",
        credentials: {},
        disabled: true,
      },
    },
    notifications: {
      enabled: true,
      on_completed: true,
      on_failed: true,
      on_cancelled: false,
      toast: { enabled: true },
      system: { enabled: false, mode: "auto" },
      email: {
        enabled: false,
        smtp_host: "",
        smtp_port: 587,
        tls: "start-tls",
        from: "",
        to: [],
        timeout_seconds: 10,
      },
      webhooks: [],
    },
    storage: defaultStorageConfig(),
    paths: defaultPathConfig(),
  };
}

describe("provider selection", () => {
  it("uses the configured default provider when available", () => {
    expect(effectiveDefaultProvider(config("second"))).toBe("second");
  });

  it("follows a changed default when the page has no manual provider choice", () => {
    const before = config("first");
    const after = config("second");

    const selected = reconcileProviderSelection(before, "");
    expect(selected).toBe("first");
    expect(reconcileProviderSelection(after, selected)).toBe("second");
  });

  it("keeps a valid manual provider choice", () => {
    expect(
      reconcileProviderSelection(config("second"), "first", {
        userSelected: true,
      }),
    ).toBe("first");
  });

  it("replaces an unavailable manual provider choice with the default", () => {
    expect(
      reconcileProviderSelection(config("first"), "disabled", {
        userSelected: true,
      }),
    ).toBe("first");
  });
});
