import { describe, expect, it } from "vitest";
import {
  dataTransferHasImage,
  imageFilesFromDataTransfer,
  normalizeImageFiles,
} from "./image-input";

function file(name: string, type: string) {
  return new File(["x"], name, { type, lastModified: 1 });
}

function fileList(files: File[]) {
  const list: Partial<FileList> = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  };
  files.forEach((entry, index) => {
    Object.defineProperty(list, index, {
      enumerable: true,
      value: entry,
    });
  });
  return list as FileList;
}

describe("image input helpers", () => {
  it("filters non-image files from file picker input", () => {
    const image = file("hero.png", "image/png");
    const text = file("notes.txt", "text/plain");

    const result = normalizeImageFiles(fileList([image, text]));

    expect(result.files).toEqual([image]);
    expect(result.ignored).toBe(1);
  });

  it("keeps image files with an image extension even when type is empty", () => {
    const image = file("reference.webp", "");

    const result = normalizeImageFiles([image]);

    expect(result.files).toEqual([image]);
    expect(result.ignored).toBe(0);
  });

  it("renames generic pasted clipboard images", () => {
    const image = file("image.png", "image/png");

    const result = normalizeImageFiles([image], {
      source: "paste",
      now: new Date("2026-04-29T10:11:12"),
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("clipboard-20260429-101112-1.png");
    expect(result.files[0].type).toBe("image/png");
  });

  it("extracts clipboard image items when files are not exposed", () => {
    const image = file("image.png", "image/png");
    const dataTransfer = {
      files: fileList([]),
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => image,
        },
      ],
      types: ["Files"],
    } as unknown as DataTransfer;

    const result = imageFilesFromDataTransfer(
      dataTransfer,
      "paste",
      new Date("2026-04-29T10:11:12"),
    );

    expect(dataTransferHasImage(dataTransfer)).toBe(true);
    expect(result.files[0].name).toBe("clipboard-20260429-101112-1.png");
  });
});
