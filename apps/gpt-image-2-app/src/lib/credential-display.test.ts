import { beforeEach, describe, expect, it } from "vitest";
import { credentialSecretDisplay } from "./credential-display";
import { setLanguagePreference } from "./i18n";

describe("credentialSecretDisplay", () => {
  beforeEach(() => setLanguagePreference("zh-CN"));
  it("does not show a secret placeholder when the credential is not present", () => {
    expect(
      credentialSecretDisplay({ source: "env", env: "", present: false }),
    ).toBeNull();
  });

  it("uses a non-secret saved marker when a redacted credential is present", () => {
    expect(credentialSecretDisplay({ source: "file", present: true })).toBe(
      "已保存",
    );
  });
});
