import { fileToUpload } from "../shared";

type UploadPayload = Awaited<ReturnType<typeof fileToUpload>>;

export async function formUploadPayload(form: FormData) {
  const metaRaw = form.get("meta");
  const meta =
    typeof metaRaw === "string"
      ? (JSON.parse(metaRaw) as Record<string, unknown>)
      : {};
  const refs: Array<{ key: string; file: File }> = [];
  let mask: UploadPayload | undefined;
  let selection_hint: UploadPayload | undefined;

  for (const [key, value] of form.entries()) {
    if (key.startsWith("ref_") && value instanceof File) {
      refs.push({ key, file: value });
    }
    if (key === "mask" && value instanceof File) {
      mask = await fileToUpload(value);
    }
    if (key === "selection_hint" && value instanceof File) {
      selection_hint = await fileToUpload(value);
    }
  }

  refs.sort((a, b) => a.key.localeCompare(b.key));
  return {
    ...meta,
    refs: await Promise.all(refs.map((entry) => fileToUpload(entry.file))),
    mask,
    selection_hint,
  };
}
