import { describe, expect, it } from "vitest";
import type { StorageConfig } from "./types";
import {
  storageConfigIssue,
  storageTargetConfigIssues,
  storageTargetConfigIssue,
  visibleStorageTargetIssues,
} from "./storage-validation";

const baseStorageConfig: StorageConfig = {
  targets: {},
  default_targets: [],
  fallback_targets: [],
  fallback_policy: "on_failure",
  upload_concurrency: 4,
  target_concurrency: 2,
};

describe("storage validation", () => {
  it("requires a directory before testing a local storage target", () => {
    expect(
      storageTargetConfigIssue("local-default", {
        type: "local",
        directory: "   ",
        public_base_url: "",
      }),
    ).toBe("存储目标「local-default」需要填写本地目录。");
  });

  it("requires a directory before saving a local storage target", () => {
    expect(
      storageConfigIssue({
        ...baseStorageConfig,
        targets: {
          "local-default": {
            type: "local",
            directory: "",
            public_base_url: null,
          },
        },
        fallback_targets: ["local-default"],
      }),
    ).toBe("存储目标「local-default」需要填写本地目录。");
  });

  it("accepts a local storage target with a directory", () => {
    expect(
      storageTargetConfigIssue("local-default", {
        type: "local",
        directory: "/tmp/gpt-image-2",
        public_base_url: "",
      }),
    ).toBeNull();
  });

  it("allows an empty local directory when the runtime does not require one", () => {
    expect(
      storageTargetConfigIssue(
        "local-default",
        {
          type: "local",
          directory: "",
          public_base_url: "",
        },
        { requireLocalDirectory: false },
      ),
    ).toBeNull();
  });

  it("reports required S3 fields", () => {
    expect(
      storageTargetConfigIssues("s3", {
        type: "s3",
        bucket: "",
        access_key_id: null,
        secret_access_key: null,
      }).map((issue) => issue.field),
    ).toEqual(["bucket", "access_key_id", "secret_access_key"]);
  });

  it("reports required URL fields for WebDAV and HTTP targets", () => {
    expect(
      storageTargetConfigIssues("webdav", {
        type: "webdav",
        url: "",
      }).map((issue) => issue.field),
    ).toEqual(["url"]);
    expect(
      storageTargetConfigIssues("http", {
        type: "http",
        url: "",
        method: "POST",
        headers: {},
      }).map((issue) => issue.field),
    ).toEqual(["url"]);
  });

  it("reports required SFTP fields including host key and auth", () => {
    expect(
      storageTargetConfigIssues("sftp", {
        type: "sftp",
        host: "",
        port: 22,
        host_key_sha256: "",
        username: "",
        remote_dir: "",
        password: null,
        private_key: null,
      }).map((issue) => issue.field),
    ).toEqual([
      "host",
      "host_key_sha256",
      "username",
      "remote_dir",
      "sftp_auth",
    ]);
  });

  it("accepts alternative auth flows for Baidu Netdisk and 123 Netdisk", () => {
    expect(
      storageTargetConfigIssues("baidu", {
        type: "baidu_netdisk",
        auth_mode: "personal",
        app_key: "",
        app_name: "",
        secret_key: null,
        access_token: null,
        refresh_token: null,
      }).map((issue) => issue.field),
    ).toEqual(["app_name", "access_token"]);
    expect(
      storageTargetConfigIssues("baidu", {
        type: "baidu_netdisk",
        auth_mode: "personal",
        app_key: "",
        app_name: "gpt-image-2",
        access_token: { source: "file", value: "token" },
      }),
    ).toEqual([]);
    expect(
      storageTargetConfigIssues("baidu", {
        type: "baidu_netdisk",
        auth_mode: "oauth",
        app_key: "",
        app_name: "gpt-image-2",
        secret_key: null,
        access_token: { source: "file", value: "hidden-token" },
        refresh_token: null,
      }).map((issue) => issue.field),
    ).toEqual(["app_key", "secret_key", "refresh_token"]);
    expect(
      storageTargetConfigIssues("pan123", {
        type: "pan123_open",
        auth_mode: "client",
        client_id: "",
        client_secret: null,
        access_token: null,
        parent_id: 0,
        use_direct_link: false,
      }).map((issue) => issue.field),
    ).toEqual(["client_id", "client_secret"]);
    expect(
      storageTargetConfigIssues("pan123", {
        type: "pan123_open",
        auth_mode: "access_token",
        client_id: "",
        access_token: { source: "env", env: "PAN123_TOKEN" },
        parent_id: 0,
        use_direct_link: false,
      }),
    ).toEqual([]);
  });

  it("hides field issues until saving or testing the target", () => {
    const target = {
      type: "pan123_open",
      auth_mode: "client",
      client_id: "",
      client_secret: null,
      access_token: null,
      parent_id: 0,
      use_direct_link: false,
    } as const;

    expect(visibleStorageTargetIssues("pan123", target)).toEqual([]);
    expect(
      visibleStorageTargetIssues("pan123", target, {
        testedTargets: new Set(["other"]),
      }),
    ).toEqual([]);
    expect(
      visibleStorageTargetIssues("pan123", target, {
        testedTargets: new Set(["pan123"]),
      }).map((issue) => issue.field),
    ).toEqual(["client_id", "client_secret"]);
    expect(
      visibleStorageTargetIssues("pan123", target, {
        saveAttempted: true,
      }).map((issue) => issue.field),
    ).toEqual(["client_id", "client_secret"]);
  });
});
