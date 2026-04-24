export function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return (
    <span
      className="inline-block border-[1.5px] border-border rounded-full"
      style={{
        width: size,
        height: size,
        borderTopColor: color || "var(--accent)",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}
