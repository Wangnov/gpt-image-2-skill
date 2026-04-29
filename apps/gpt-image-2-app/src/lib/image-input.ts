export type ImageFileSource = "picker" | "drop" | "paste";

export type ImageFileResult = {
  files: File[];
  ignored: number;
};

type FileCollection =
  | FileList
  | readonly File[]
  | Iterable<File>
  | null
  | undefined;

const IMAGE_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
};

function fileArray(files: FileCollection) {
  if (!files) return [];
  return Array.from(files as ArrayLike<File> | Iterable<File>).filter(Boolean);
}

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

function timestampName(now: Date | number) {
  const date = typeof now === "number" ? new Date(now) : now;
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function extensionFor(file: File) {
  if (file.type && IMAGE_EXTENSION_BY_TYPE[file.type]) {
    return IMAGE_EXTENSION_BY_TYPE[file.type];
  }
  const match = /\.([a-z0-9]+)$/i.exec(file.name);
  return match?.[1]?.toLowerCase() || "png";
}

function normalizePastedImageName(file: File, index: number, now: Date | number) {
  if (!/^image(?:\s*\(\d+\))?\.[a-z0-9]+$/i.test(file.name)) {
    return file;
  }
  const ext = extensionFor(file);
  return new File([file], `clipboard-${timestampName(now)}-${index + 1}.${ext}`, {
    type: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
    lastModified: file.lastModified || Number(new Date(now)),
  });
}

export function normalizeImageFiles(
  files: FileCollection,
  options: { source?: ImageFileSource; now?: Date | number } = {},
): ImageFileResult {
  const source = options.source ?? "picker";
  const now = options.now ?? Date.now();
  const input = fileArray(files);
  const images = input.filter(isImageFile).map((file, index) => {
    if (source !== "paste") return file;
    if (!file.name) {
      const ext = extensionFor(file);
      return new File(
        [file],
        `clipboard-${timestampName(now)}-${index + 1}.${ext}`,
        {
          type: file.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
          lastModified: file.lastModified || Number(new Date(now)),
        },
      );
    }
    return normalizePastedImageName(file, index, now);
  });

  return {
    files: images,
    ignored: input.length - images.length,
  };
}

export function dataTransferHasImage(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  const files = Array.from(dataTransfer.files ?? []);
  if (files.some(isImageFile)) return true;
  const items = Array.from(dataTransfer.items ?? []);
  if (items.some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
    return true;
  }
  return Array.from(dataTransfer.types ?? []).includes("Files");
}

export function imageFilesFromDataTransfer(
  dataTransfer: DataTransfer | null,
  source: ImageFileSource,
  now: Date | number = Date.now(),
): ImageFileResult {
  if (!dataTransfer) return { files: [], ignored: 0 };
  const files = Array.from(dataTransfer.files ?? []);
  if (files.length > 0) {
    return normalizeImageFiles(files, { source, now });
  }

  const itemFiles = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  return normalizeImageFiles(itemFiles, { source, now });
}
