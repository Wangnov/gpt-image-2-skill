import { describe, expect, it } from "vitest";
import {
  canActAsOrigin,
  defaultPathConfig,
  defaultStorageConfig,
  migrateLegacyToPipeline,
  normalizeStorageConfig,
} from "./shared";

describe("normalizeStorageConfig", () => {
  it("does not create archive targets by default", () => {
    const normalized = normalizeStorageConfig();

    expect(normalized.targets).toEqual({});
    expect(normalized.default_targets).toEqual([]);
    expect(normalized.fallback_targets).toEqual([]);
    expect(normalized.fallback_policy).toBe("on_failure");
  });

  it("defaults the pipeline to local_only with empty archives", () => {
    const normalized = normalizeStorageConfig();

    expect(normalized.pipeline).toEqual({
      mode: "local_only",
      origin: null,
      archives: [],
      cleanup: { mode: "never" },
    });
  });

  it("migrates legacy default/fallback targets into pipeline archives", () => {
    const normalized = normalizeStorageConfig({
      default_targets: ["a"],
      fallback_targets: ["b"],
      fallback_policy: "on_failure",
    });

    expect(normalized.pipeline?.mode).toBe("cloud_archive_only");
    expect(normalized.pipeline?.archives).toEqual(["a", "b"]);
    expect(normalized.pipeline?.origin).toBeNull();
  });

  it("migrates legacy 'always' policy into mirror mode", () => {
    const normalized = normalizeStorageConfig({
      default_targets: ["a"],
      fallback_targets: ["b"],
      fallback_policy: "always",
    });

    expect(normalized.pipeline?.mode).toBe("mirror");
    expect(normalized.pipeline?.archives).toEqual(["a", "b"]);
  });

  it("preserves an explicit pipeline over legacy fields", () => {
    const normalized = normalizeStorageConfig({
      default_targets: ["junk"],
      fallback_targets: ["junk2"],
      fallback_policy: "always",
      pipeline: {
        mode: "cloud_primary",
        origin: "s3-main",
        archives: ["webdav-1"],
        cleanup: { mode: "never" },
      },
    });

    expect(normalized.pipeline).toEqual({
      mode: "cloud_primary",
      origin: "s3-main",
      archives: ["webdav-1"],
      cleanup: { mode: "never" },
    });
  });

  it("treats managed policy as advisory when user overrides are allowed", () => {
    const normalized = normalizeStorageConfig({
      pipeline: {
        mode: "mirror",
        origin: null,
        archives: ["user-archive"],
        cleanup: { mode: "never" },
      },
      policy: {
        managed: true,
        allow_user_overrides: true,
        allowed_modes: ["cloud_primary"],
        locked_origin: "r2-origin",
        locked_archives: ["audit-webhook"],
        message: null,
      },
    });

    expect(normalized.pipeline).toEqual({
      mode: "mirror",
      origin: null,
      archives: ["user-archive"],
      cleanup: { mode: "never" },
    });
  });

  it("enforces managed policy only when user overrides are disabled", () => {
    const normalized = normalizeStorageConfig({
      pipeline: {
        mode: "mirror",
        origin: null,
        archives: ["user-archive"],
        cleanup: { mode: "never" },
      },
      policy: {
        managed: true,
        allow_user_overrides: false,
        allowed_modes: ["cloud_primary"],
        locked_origin: "r2-origin",
        locked_archives: ["audit-webhook", "r2-origin"],
        message: null,
      },
    });

    expect(normalized.pipeline).toEqual({
      mode: "cloud_primary",
      origin: "r2-origin",
      archives: ["audit-webhook"],
      cleanup: { mode: "never" },
    });
  });

  it("infers netdisk auth modes from saved credential fields", () => {
    const normalized = normalizeStorageConfig({
      targets: {
        baidu: {
          type: "baidu_netdisk",
          app_key: "",
          app_name: "gpt-image-2",
          access_token: { source: "file", present: true },
        },
        pan123: {
          type: "pan123_open",
          client_id: "",
          access_token: { source: "env", env: "PAN123_TOKEN" },
          parent_id: 0,
          use_direct_link: false,
        },
      },
    });

    expect(normalized.targets.baidu).toMatchObject({
      type: "baidu_netdisk",
      auth_mode: "personal",
    });
    expect(normalized.targets.pan123).toMatchObject({
      type: "pan123_open",
      auth_mode: "access_token",
    });
  });
});

describe("migrateLegacyToPipeline", () => {
  it("returns local_only when both lists empty", () => {
    expect(
      migrateLegacyToPipeline({
        default_targets: [],
        fallback_targets: [],
        fallback_policy: "on_failure",
      }),
    ).toEqual({
      mode: "local_only",
      origin: null,
      archives: [],
      cleanup: { mode: "never" },
    });
  });

  it("drops fallback list when policy is 'never'", () => {
    expect(
      migrateLegacyToPipeline({
        default_targets: ["a"],
        fallback_targets: ["b"],
        fallback_policy: "never",
      }).archives,
    ).toEqual(["a"]);
  });

  it("dedupes overlapping target names", () => {
    expect(
      migrateLegacyToPipeline({
        default_targets: ["a", "b"],
        fallback_targets: ["a"],
        fallback_policy: "on_failure",
      }).archives,
    ).toEqual(["a", "b"]);
  });
});

describe("canActAsOrigin", () => {
  it("rejects http (webhook) targets as Origin", () => {
    expect(
      canActAsOrigin({
        type: "http",
        url: "https://example.com/upload",
        method: "POST",
        headers: {},
      }),
    ).toBe(false);
  });

  it("rejects netdisk targets until readback is implemented", () => {
    expect(
      canActAsOrigin({
        type: "baidu_netdisk",
        auth_mode: "personal",
        app_key: "",
        app_name: "gpt-image-2",
        access_token: { source: "file", value: "token" },
      }),
    ).toBe(false);
    expect(
      canActAsOrigin({
        type: "pan123_open",
        auth_mode: "access_token",
        client_id: "",
        access_token: { source: "env", env: "PAN123_TOKEN" },
        parent_id: 0,
        use_direct_link: true,
      }),
    ).toBe(false);
  });

  it("accepts local / s3 / webdav / sftp targets as Origin", () => {
    expect(canActAsOrigin({ type: "local", directory: "/data" })).toBe(true);
    expect(canActAsOrigin({ type: "s3", bucket: "b" })).toBe(true);
    expect(canActAsOrigin({ type: "webdav", url: "https://x" })).toBe(true);
    expect(
      canActAsOrigin({
        type: "sftp",
        host: "h",
        port: 22,
        username: "u",
        remote_dir: "/d",
      }),
    ).toBe(true);
  });
});

describe("defaultStorageConfig", () => {
  it("exposes a default pipeline", () => {
    expect(defaultStorageConfig().pipeline?.mode).toBe("local_only");
  });
});

describe("defaultPathConfig", () => {
  it("exports to the result library by default", () => {
    expect(defaultPathConfig().default_export_dir).toEqual({
      mode: "result_library",
      path: null,
    });
  });
});
