import { useEffect, useState } from "react";
import { RevealImage } from "@/components/ui/reveal-image";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";

export function JobPreviewImage({
  url,
  seed,
  variant,
  imageClassName = "h-full w-full object-cover",
  placeholderClassName = "h-full w-full",
}: {
  url: string | null;
  seed: number;
  variant: string;
  imageClassName?: string;
  placeholderClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <RevealImage
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className={imageClassName}
        draggable={false}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={placeholderClassName}>
      <PlaceholderImage seed={seed} variant={variant} />
    </div>
  );
}
