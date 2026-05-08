export type MaskPoint = { x: number; y: number };
export type MaskSnapshot = string | null;
export type MaskDrawingTool = "brush" | "erase" | "rect" | "ellipse";

export function canvasPointerPosition(
  canvas: HTMLCanvasElement,
  event: { clientX: number; clientY: number },
  width: number,
  height: number,
): MaskPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (width / rect.width),
    y: (event.clientY - rect.top) * (height / rect.height),
  };
}

function hasMaskPixels(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
) {
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 8) return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function canvasSnapshot(canvas: HTMLCanvasElement): MaskSnapshot {
  const ctx = canvas.getContext("2d");
  if (!ctx || !hasMaskPixels(canvas, ctx)) return null;
  return canvas.toDataURL("image/png");
}

export function clearCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
}

export function configureStroke(
  ctx: CanvasRenderingContext2D,
  activeTool: MaskDrawingTool,
  strokeWidth: number,
) {
  ctx.globalCompositeOperation =
    activeTool === "erase" ? "destination-out" : "source-over";
  ctx.fillStyle = "rgba(16,160,108,0.85)";
  ctx.strokeStyle = "rgba(16,160,108,0.88)";
  ctx.lineWidth = Math.max(1, strokeWidth);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

export function drawPoint(
  ctx: CanvasRenderingContext2D,
  activeTool: MaskDrawingTool,
  strokeWidth: number,
  point: MaskPoint,
) {
  ctx.save();
  configureStroke(ctx, activeTool, strokeWidth);
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(1, strokeWidth / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  activeTool: MaskDrawingTool,
  strokeWidth: number,
  from: MaskPoint,
  to: MaskPoint,
) {
  ctx.save();
  configureStroke(ctx, activeTool, strokeWidth);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  activeTool: MaskDrawingTool,
  strokeWidth: number,
  from: MaskPoint,
  to: MaskPoint,
) {
  ctx.save();
  configureStroke(ctx, activeTool, strokeWidth);
  ctx.globalCompositeOperation = "source-over";
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (width < 1 || height < 1) {
    ctx.restore();
    return;
  }
  ctx.beginPath();
  if (activeTool === "rect") {
    ctx.rect(x, y, width, height);
  } else {
    ctx.ellipse(
      x + width / 2,
      y + height / 2,
      width / 2,
      height / 2,
      0,
      0,
      Math.PI * 2,
    );
  }
  ctx.stroke();
  ctx.restore();
}
