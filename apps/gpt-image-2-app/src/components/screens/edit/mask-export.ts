import type { MaskExport } from "./mask-canvas";

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas export failed"));
    }, "image/png");
  });
}

export function loadImage(src?: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    if (!src) {
      reject(new Error("Missing image"));
      return;
    }
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export async function exportMaskPayload(
  selectionCanvas: HTMLCanvasElement,
  imageUrl?: string,
): Promise<MaskExport> {
  const width = selectionCanvas.width;
  const height = selectionCanvas.height;
  const image = await loadImage(imageUrl);

  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = width;
  targetCanvas.height = height;
  const targetCtx = targetCanvas.getContext("2d");
  if (!targetCtx) throw new Error("Canvas unavailable");
  targetCtx.drawImage(image, 0, 0, width, height);

  const selectionCtx = selectionCanvas.getContext("2d");
  if (!selectionCtx) throw new Error("Canvas unavailable");
  const selectionData = selectionCtx.getImageData(0, 0, width, height);

  const nativeMaskCanvas = document.createElement("canvas");
  nativeMaskCanvas.width = width;
  nativeMaskCanvas.height = height;
  const nativeMaskCtx = nativeMaskCanvas.getContext("2d");
  if (!nativeMaskCtx) throw new Error("Canvas unavailable");
  const nativeMask = nativeMaskCtx.createImageData(width, height);
  let selectedPixels = 0;
  for (let i = 0; i < nativeMask.data.length; i += 4) {
    const selected = selectionData.data[i + 3] > 8;
    if (selected) selectedPixels += 1;
    nativeMask.data[i] = 255;
    nativeMask.data[i + 1] = 255;
    nativeMask.data[i + 2] = 255;
    nativeMask.data[i + 3] = selected ? 0 : 255;
  }
  nativeMaskCtx.putImageData(nativeMask, 0, 0);

  const hintCanvas = document.createElement("canvas");
  hintCanvas.width = width;
  hintCanvas.height = height;
  const hintCtx = hintCanvas.getContext("2d");
  if (!hintCtx) throw new Error("Canvas unavailable");
  hintCtx.drawImage(targetCanvas, 0, 0);
  hintCtx.drawImage(selectionCanvas, 0, 0);

  return {
    targetImage: await canvasToBlob(targetCanvas),
    nativeMask: await canvasToBlob(nativeMaskCanvas),
    selectionHint: await canvasToBlob(hintCanvas),
    hasSelection: selectedPixels > 0,
  };
}
