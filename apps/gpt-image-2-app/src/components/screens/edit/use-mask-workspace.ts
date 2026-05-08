import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  type MaskHistoryState,
  type MaskMode,
  type MaskTool,
} from "./mask-canvas";
import { clampZoom } from "./shared";

export function useMaskWorkspace({
  active,
  targetRefId,
  usesRegion,
}: {
  active: boolean;
  targetRefId?: string;
  usesRegion: boolean;
}) {
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const maskToolbarHostRef = useRef<HTMLDivElement>(null);
  const maskToolbarRef = useRef<HTMLDivElement>(null);
  const [brushSize, setBrushSize] = useState(12);
  const [maskTool, setMaskTool] = useState<MaskTool>("brush");
  const [clearKey, setClearKey] = useState(0);
  const [undoKey, setUndoKey] = useState(0);
  const [redoKey, setRedoKey] = useState(0);
  const [maskHistory, setMaskHistory] = useState<MaskHistoryState>({
    canUndo: false,
    canRedo: false,
  });
  const [imageSize, setImageSize] = useState({ width: 1024, height: 1024 });
  const [zoom, setZoom] = useState(1);
  const [maskToolbarScale, setMaskToolbarScale] = useState(1);
  const [panPinned, setPanPinned] = useState(false);
  const [spacePanning, setSpacePanning] = useState(false);

  const panMode = panPinned || spacePanning;
  const maskMode: MaskMode = maskTool === "erase" ? "erase" : "paint";

  const triggerMaskUndo = useCallback(() => setUndoKey((key) => key + 1), []);
  const triggerMaskRedo = useCallback(() => setRedoKey((key) => key + 1), []);

  const updateMaskToolbarScale = useCallback(() => {
    const host = maskToolbarHostRef.current;
    const toolbar = maskToolbarRef.current;
    if (!host || !toolbar) return;
    const naturalWidth = toolbar.scrollWidth;
    const availableWidth = host.clientWidth;
    if (naturalWidth <= 0 || availableWidth <= 0) return;
    const next = Math.min(1, Math.max(0.45, availableWidth / naturalWidth));
    setMaskToolbarScale((current) =>
      Math.abs(current - next) < 0.005 ? current : next,
    );
  }, []);

  const fitCanvasToViewport = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const padding = 32;
    const fit = Math.min(
      (viewport.clientWidth - padding) / imageSize.width,
      (viewport.clientHeight - padding) / imageSize.height,
    );
    setZoom(clampZoom(Number.isFinite(fit) && fit > 0 ? fit : 1));
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(
        0,
        (viewport.scrollWidth - viewport.clientWidth) / 2,
      );
      viewport.scrollTop = Math.max(
        0,
        (viewport.scrollHeight - viewport.clientHeight) / 2,
      );
    });
  }, [imageSize.height, imageSize.width]);

  const handleMaskImageSize = useCallback(
    (size: { width: number; height: number }) => setImageSize(size),
    [],
  );

  useEffect(() => {
    if (!active || !usesRegion) return;
    const timer = window.setTimeout(fitCanvasToViewport, 60);
    return () => window.clearTimeout(timer);
  }, [active, fitCanvasToViewport, targetRefId, usesRegion]);

  useEffect(() => {
    if (!active || !usesRegion || !targetRefId) {
      setMaskToolbarScale(1);
      return;
    }
    const host = maskToolbarHostRef.current;
    const toolbar = maskToolbarRef.current;
    if (!host || !toolbar) return;
    updateMaskToolbarScale();
    const observer = new ResizeObserver(updateMaskToolbarScale);
    observer.observe(host);
    observer.observe(toolbar);
    window.addEventListener("resize", updateMaskToolbarScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateMaskToolbarScale);
    };
  }, [active, targetRefId, updateMaskToolbarScale, usesRegion]);

  useEffect(() => {
    if (!active || !usesRegion || !targetRefId) return;
    updateMaskToolbarScale();
  }, [active, targetRefId, updateMaskToolbarScale, usesRegion, zoom]);

  useEffect(() => {
    if (!usesRegion) return;
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest("input, textarea, select, [contenteditable='true']"),
      );
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const isModifierShortcut = event.metaKey || event.ctrlKey;
      const isUndo = isModifierShortcut && key === "z" && !event.shiftKey;
      const isRedo =
        isModifierShortcut && ((key === "z" && event.shiftKey) || key === "y");
      if (isUndo || isRedo) {
        event.preventDefault();
        if (isRedo) triggerMaskRedo();
        else triggerMaskUndo();
        return;
      }
      if (event.key !== " " || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      event.preventDefault();
      setSpacePanning(true);
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === " ") setSpacePanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      setSpacePanning(false);
    };
  }, [active, triggerMaskRedo, triggerMaskUndo, usesRegion]);

  return {
    brushSize,
    canvasViewportRef,
    clearKey,
    fitCanvasToViewport,
    handleMaskImageSize,
    maskHistory,
    maskMode,
    maskTool,
    maskToolbarHostRef,
    maskToolbarRef,
    maskToolbarScale,
    panMode,
    panPinned,
    redoKey,
    setBrushSize: setBrushSize as Dispatch<SetStateAction<number>>,
    setClearKey: setClearKey as Dispatch<SetStateAction<number>>,
    setMaskHistory,
    setMaskTool: setMaskTool as Dispatch<SetStateAction<MaskTool>>,
    setPanPinned: setPanPinned as Dispatch<SetStateAction<boolean>>,
    setZoom: setZoom as Dispatch<SetStateAction<number>>,
    triggerMaskRedo,
    triggerMaskUndo,
    undoKey,
    zoom,
  };
}
