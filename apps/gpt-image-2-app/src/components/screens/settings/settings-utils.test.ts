import { describe, expect, it } from "vitest";
import { defaultStorageConfig } from "@/lib/api/shared";
import { prepareStorageConfigForSave } from "./settings-utils";

describe("prepareStorageConfigForSave", () => {
  it("removes a cloud_primary origin from archive targets", () => {
    const saved = prepareStorageConfigForSave({
      ...defaultStorageConfig(),
      targets: {
        origin: {
          type: "local",
          directory: "/data/origin",
          public_base_url: null,
        },
        backup: {
          type: "local",
          directory: "/data/backup",
          public_base_url: null,
        },
      },
      pipeline: {
        mode: "cloud_primary",
        origin: "origin",
        archives: ["origin", "backup"],
        cleanup: { mode: "never" },
      },
    });

    expect(saved.pipeline).toEqual({
      mode: "cloud_primary",
      origin: "origin",
      archives: ["backup"],
      cleanup: { mode: "never" },
    });
  });

  it("drops origin and archives for local_only mode", () => {
    const saved = prepareStorageConfigForSave({
      ...defaultStorageConfig(),
      targets: {
        origin: {
          type: "local",
          directory: "/data/origin",
          public_base_url: null,
        },
      },
      pipeline: {
        mode: "local_only",
        origin: "origin",
        archives: ["origin"],
        cleanup: { mode: "never" },
      },
    });

    expect(saved.pipeline).toEqual({
      mode: "local_only",
      origin: null,
      archives: [],
      cleanup: { mode: "never" },
    });
  });
});
