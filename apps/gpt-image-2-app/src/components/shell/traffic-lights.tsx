import { useState } from "react";

export function TrafficLights({ onClose }: { onClose?: () => void }) {
  const [hover, setHover] = useState(false);
  const Dot = ({ bg, icon, onClick }: { bg: string; icon?: string; onClick?: () => void }) => (
    <button
      onClick={onClick}
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        background: bg,
        border: "0.5px solid rgba(0,0,0,0.12)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(0,0,0,0.5)",
        fontSize: 8,
        fontWeight: 800,
      }}
    >
      {hover ? icon : null}
    </button>
  );
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: "flex", gap: 8, alignItems: "center" }}
    >
      <Dot bg="#ff5f57" icon="×" onClick={onClose} />
      <Dot bg="#febc2e" icon="−" />
      <Dot bg="#28c840" icon="+" />
    </div>
  );
}
