import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { PlaceholderImage } from "./placeholder-image";

type OutputMeta = { index: number; url?: string; selected?: boolean; seed?: number };

export function OutputTile({
  output,
  onSelect,
  onDownload,
  onOpen,
}: {
  output: OutputMeta;
  onSelect?: () => void;
  onDownload?: () => void;
  onOpen?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const letter = String.fromCharCode(97 + output.index);
  const showImage = output.url && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [output.url]);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      className={[
        "relative overflow-hidden aspect-square rounded-lg cursor-pointer transition-all",
        "border-[1.5px]",
        output.selected ? "border-accent shadow-[0_0_0_3px_var(--accent-faint)]" : "border-border shadow-sm",
      ].join(" ")}
      style={{ background: "var(--bg-sunken)" }}
    >
      {showImage ? (
        <img
          src={output.url}
          alt={`output-${output.index}`}
          className="w-full h-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <PlaceholderImage seed={output.seed ?? output.index * 11 + 7} variant={letter} />
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "20px 10px 8px",
          background: "linear-gradient(to top, rgba(0,0,0,0.55), transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "#fff",
        }}
      >
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-[3px] backdrop-blur-sm font-mono font-bold text-[10px] uppercase"
            style={{ background: "rgba(255,255,255,0.2)" }}
          >
            {letter}
          </span>
          {output.seed != null && (
            <span className="text-[10.5px] font-mono opacity-85">seed {output.seed}</span>
          )}
        </div>
        {output.selected && <Icon name="check" size={12} />}
      </div>
      {hover && (
        <div className="absolute top-2 right-2 flex gap-1 animate-fade-in">
          {onOpen && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className="w-[26px] h-[26px] rounded-[4px] bg-black/60 backdrop-blur-sm text-white border-none flex items-center justify-center"
            >
              <Icon name="external" size={13} />
            </button>
          )}
          {onDownload && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(); }}
              className="w-[26px] h-[26px] rounded-[4px] bg-black/60 backdrop-blur-sm text-white border-none flex items-center justify-center"
            >
              <Icon name="download" size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
