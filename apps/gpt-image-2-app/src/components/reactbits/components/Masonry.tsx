import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

export interface MasonryItem<T> {
  id: string;
  heightRatio?: number;
  data: T;
}

export interface MasonryProps<T> {
  items: MasonryItem<T>[];
  renderItem: (item: MasonryItem<T>) => ReactNode;
  className?: string;
  itemClassName?: string;
  gap?: number;
  minColumnWidth?: number;
  maxColumns?: number;
  animateFrom?: "bottom" | "top" | "center";
}

interface GridItem<T> extends MasonryItem<T> {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function Masonry<T>({
  items,
  renderItem,
  className,
  itemClassName,
  gap = 10,
  minColumnWidth = 136,
  maxColumns = 4,
  animateFrom = "bottom",
}: MasonryProps<T>) {
  const [containerRef, width] = useMeasureWidth<HTMLDivElement>();
  const columns = useMemo(() => {
    if (width <= 0) return 1;
    return Math.max(
      1,
      Math.min(maxColumns, Math.floor((width + gap) / (minColumnWidth + gap))),
    );
  }, [gap, maxColumns, minColumnWidth, width]);

  const { grid, height } = useMemo(() => {
    if (width <= 0) return { grid: [] as GridItem<T>[], height: 0 };

    const columnHeights = new Array(columns).fill(0);
    const columnWidth = (width - gap * (columns - 1)) / columns;
    const laidOut = items.map((item) => {
      const column = columnHeights.indexOf(Math.min(...columnHeights));
      const x = column * (columnWidth + gap);
      const y = columnHeights[column];
      const ratio = clamp(item.heightRatio ?? 1, 0.68, 1.55);
      const height = Math.round(columnWidth * ratio);
      columnHeights[column] += height + gap;
      return {
        ...item,
        x,
        y,
        width: columnWidth,
        height,
      };
    });

    return {
      grid: laidOut,
      height: Math.max(0, Math.max(...columnHeights) - gap),
    };
  }, [columns, gap, items, width]);

  return (
    <div
      ref={containerRef}
      className={cn("relative w-full min-w-0", className)}
      style={{
        minHeight: items.length > 0 && height === 0 ? 240 : undefined,
        height: height || undefined,
      }}
    >
      <AnimatePresence mode="popLayout">
        {grid.map((item, index) => (
          <motion.div
            key={item.id}
            layout
            className={cn("absolute left-0 top-0 box-border", itemClassName)}
            initial={initialState(item, animateFrom)}
            animate={{
              opacity: 1,
              x: item.x,
              y: item.y,
              width: item.width,
              height: item.height,
              filter: "blur(0px)",
              scale: 1,
            }}
            exit={{
              opacity: 0,
              scale: 0.96,
              filter: "blur(8px)",
              transition: { duration: 0.18 },
            }}
            transition={{
              duration: 0.42,
              delay: Math.min(index * 0.025, 0.16),
              ease: [0.16, 1, 0.3, 1],
            }}
            style={{ willChange: "transform, width, height, opacity" }}
          >
            {renderItem(item)}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function initialState<T>(
  item: GridItem<T>,
  animateFrom: MasonryProps<T>["animateFrom"],
) {
  switch (animateFrom) {
    case "top":
      return {
        opacity: 0,
        x: item.x,
        y: item.y - 80,
        width: item.width,
        height: item.height,
        filter: "blur(10px)",
      };
    case "center":
      return {
        opacity: 0,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        filter: "blur(10px)",
        scale: 0.94,
      };
    case "bottom":
    default:
      return {
        opacity: 0,
        x: item.x,
        y: item.y + 80,
        width: item.width,
        height: item.height,
        filter: "blur(10px)",
      };
  }
}

function useMeasureWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
