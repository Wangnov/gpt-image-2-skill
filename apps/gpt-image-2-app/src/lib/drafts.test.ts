import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCreativeDrafts,
  enqueueOfflineGenerateDraft,
  loadEditDraft,
  loadGenerateDraft,
  loadOfflineGenerateDrafts,
  removeOfflineGenerateDraft,
  saveEditDraft,
  saveGenerateDraft,
} from "./drafts";

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  error: Error | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob) {
    void blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      })
      .catch((error) => {
        this.error = error instanceof Error ? error : new Error(String(error));
        this.onerror?.();
      });
  }
}

describe("creative drafts", () => {
  beforeEach(async () => {
    vi.stubGlobal("FileReader", MockFileReader);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:draft"),
    });
    await clearCreativeDrafts();
  });

  afterEach(async () => {
    await clearCreativeDrafts();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serializes and restores generate drafts", async () => {
    await saveGenerateDraft({
      prompt: "glass watch on velvet",
      provider: "mock",
      size: "1536x1024",
      quality: "high",
      format: "webp",
      n: 3,
    });

    const draft = await loadGenerateDraft();

    expect(draft).toMatchObject({
      prompt: "glass watch on velvet",
      provider: "mock",
      size: "1536x1024",
      quality: "high",
      format: "webp",
      n: 3,
    });
    expect(draft?.updatedAt).toBeTypeOf("number");
  });

  it("stores edit images and mask snapshots in IndexedDB", async () => {
    await saveEditDraft({
      editMode: "region",
      prompt: "turn the label matte black",
      provider: "mock",
      size: "1024x1024",
      quality: "auto",
      format: "png",
      n: 1,
      refs: [
        {
          id: "r1",
          name: "reference.png",
          file: new File(["ref-bytes"], "reference.png", {
            type: "image/png",
          }),
        },
      ],
      selectedRef: "r1",
      targetRefId: "r1",
      brushSize: 32,
      maskMode: "paint",
      maskSnapshots: {
        r1: "data:image/png;base64,bWFzaw==",
      },
    });

    const draft = await loadEditDraft();

    expect(draft?.prompt).toBe("turn the label matte black");
    expect(draft?.refs).toHaveLength(1);
    expect(draft?.refs[0]).toMatchObject({
      id: "r1",
      name: "reference.png",
    });
    expect(await draft?.refs[0].file.text()).toBe("ref-bytes");
    expect(draft?.maskSnapshots.r1).toContain("data:image/png;base64");
  });

  it("clears saved draft records and assets", async () => {
    await saveGenerateDraft({
      prompt: "temporary",
      provider: "mock",
      size: "1024x1024",
      quality: "auto",
      format: "png",
      n: 1,
    });

    await clearCreativeDrafts();

    expect(await loadGenerateDraft()).toBeNull();
  });

  it("queues offline generate drafts and removes restored entries", async () => {
    await enqueueOfflineGenerateDraft(
      {
        prompt: "city in rain",
        provider: "mock",
        size: "1024x1024",
        quality: "auto",
        format: "png",
        n: 2,
      },
      "network offline",
    );

    const drafts = await loadOfflineGenerateDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      prompt: "city in rain",
      provider: "mock",
      reason: "network offline",
    });

    await removeOfflineGenerateDraft(drafts[0].id);
    expect(await loadOfflineGenerateDrafts()).toEqual([]);
  });
});
