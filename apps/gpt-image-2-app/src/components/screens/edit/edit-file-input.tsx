import { type RefObject } from "react";

export function EditFileInput({
  addRef,
  fileInputRef,
}: {
  addRef: (files: FileList | null) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      accept="image/*"
      className="hidden"
      onChange={(event) => {
        addRef(event.target.files);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }}
    />
  );
}
