export function Spinner({ size = 14, color }: { size?: number; color?: string }) {
  return (
    <span
      className="inline-block rounded-full"
      style={{
        width: size,
        height: size,
        border: "1.5px solid var(--w-10)",
        borderTopColor: color || "var(--accent)",
        animation: "spin 0.8s linear infinite",
      }}
    />
  );
}
