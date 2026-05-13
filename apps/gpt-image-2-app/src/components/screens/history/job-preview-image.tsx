import { useEffect, useState } from "react";
import { RevealImage } from "@/components/ui/reveal-image";
import { PlaceholderImage } from "@/components/screens/shared/placeholder-image";

export function JobPreviewImage({
  url,
  seed,
  variant,
  recover,
  imageClassName = "h-full w-full object-cover",
  placeholderClassName = "h-full w-full",
}: {
  url: string | null;
  seed: number;
  variant: string;
  recover?: () => Promise<string | null | undefined>;
  imageClassName?: string;
  placeholderClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [recoveredUrl, setRecoveredUrl] = useState<string | null>(null);
  const [recoverAttempted, setRecoverAttempted] = useState(false);
  const displayUrl = recoveredUrl ?? url;

  useEffect(() => {
    setFailed(false);
    setRecoveredUrl(null);
    setRecoverAttempted(false);
  }, [url]);

  const handleError = () => {
    if (!recover || recoverAttempted) {
      setFailed(true);
      return;
    }
    setRecoverAttempted(true);
    void recover()
      .then((nextUrl) => {
        if (!nextUrl) {
          setFailed(true);
          return;
        }
        setRecoveredUrl(
          `${nextUrl}${nextUrl.includes("?") ? "&" : "?"}rehydrated=${Date.now()}`,
        );
        setFailed(false);
      })
      .catch(() => setFailed(true));
  };

  if (displayUrl && !failed) {
    return (
      <RevealImage
        src={displayUrl}
        alt=""
        loading="lazy"
        decoding="async"
        className={imageClassName}
        draggable={false}
        onError={handleError}
      />
    );
  }

  return (
    <div className={placeholderClassName}>
      <PlaceholderImage
        seed={seed}
        variant={variant}
        label={displayUrl && failed ? "远端不可用" : undefined}
      />
    </div>
  );
}
