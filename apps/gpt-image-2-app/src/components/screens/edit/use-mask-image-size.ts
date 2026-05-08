import { useEffect, useState } from "react";
import { loadImage } from "./mask-export";

const FALLBACK_IMAGE_SIZE = { width: 1024, height: 1024 };

export function useMaskImageSize({
  imageUrl,
  onImageSizeChange,
}: {
  imageUrl?: string;
  onImageSizeChange?: (size: { width: number; height: number }) => void;
}) {
  const [imageSize, setImageSize] = useState(FALLBACK_IMAGE_SIZE);

  useEffect(() => {
    if (!imageUrl) {
      setImageSize(FALLBACK_IMAGE_SIZE);
      onImageSizeChange?.(FALLBACK_IMAGE_SIZE);
      return;
    }
    let cancelled = false;
    loadImage(imageUrl)
      .then((image) => {
        if (cancelled) return;
        const next = {
          width: Math.max(1, image.naturalWidth),
          height: Math.max(1, image.naturalHeight),
        };
        setImageSize(next);
        onImageSizeChange?.(next);
      })
      .catch(() => {
        if (!cancelled) {
          setImageSize(FALLBACK_IMAGE_SIZE);
          onImageSizeChange?.(FALLBACK_IMAGE_SIZE);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, onImageSizeChange]);

  return imageSize;
}
