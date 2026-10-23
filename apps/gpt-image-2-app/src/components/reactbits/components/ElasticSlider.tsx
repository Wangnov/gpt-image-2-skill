import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

const MAX_OVERFLOW = 50;

type OverflowRegion = "left" | "middle" | "right";

export interface ElasticSliderProps {
  id?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  disabled?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  valueSuffix?: string;
  valueWidthClassName?: string;
  formatValue?: (value: number) => string;
}

export default function ElasticSlider({
  id,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  className,
  disabled = false,
  leftIcon,
  rightIcon,
  valueSuffix = "",
  valueWidthClassName = "w-10",
  formatValue,
}: ElasticSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const activePointerId = useRef<number | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [region, setRegion] = useState<OverflowRegion>("middle");
  const [overflow, setOverflow] = useState(0);

  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  const safeStep = step > 0 ? step : 1;
  const safeValue = clamp(value, safeMin, safeMax);
  const range = safeMax - safeMin;
  const percent = range === 0 ? 0 : ((safeValue - safeMin) / range) * 100;
  const isLifted = isActive || isHovering;
  const displayValue =
    formatValue?.(safeValue) ?? `${Math.round(safeValue)}${valueSuffix}`;

  const emitValue = (nextValue: number) => {
    const stepped = snapToStep(nextValue, safeMin, safeStep);
    const next = clamp(stepped, safeMin, safeMax);
    if (next !== safeValue) {
      onChange(next);
    }
  };

  const updateFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;

    const rawRatio = (clientX - rect.left) / rect.width;
    const nextValue = safeMin + rawRatio * range;
    emitValue(nextValue);

    if (rawRatio < 0) {
      setRegion("left");
      setOverflow(decay(Math.abs(clientX - rect.left), MAX_OVERFLOW));
    } else if (rawRatio > 1) {
      setRegion("right");
      setOverflow(decay(Math.abs(clientX - rect.right), MAX_OVERFLOW));
    } else {
      setRegion("middle");
      setOverflow(0);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    activePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsActive(true);
    updateFromClientX(event.clientX);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || activePointerId.current !== event.pointerId) return;
    updateFromClientX(event.clientX);
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current === event.pointerId) {
      activePointerId.current = null;
    }
    setIsActive(false);
    setRegion("middle");
    setOverflow(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    const pageStep = safeStep * 10;
    const keyDeltas: Record<string, number> = {
      ArrowLeft: -safeStep,
      ArrowDown: -safeStep,
      ArrowRight: safeStep,
      ArrowUp: safeStep,
      PageDown: -pageStep,
      PageUp: pageStep,
    };

    if (event.key === "Home") {
      event.preventDefault();
      emitValue(safeMin);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      emitValue(safeMax);
      return;
    }

    const delta = keyDeltas[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      emitValue(safeValue + delta);
    }
  };

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 text-muted",
        disabled && "opacity-50",
        className,
      )}
    >
      {leftIcon ? (
        <motion.span
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center text-faint"
          animate={{
            x: region === "left" ? -overflow * 0.32 : 0,
            scale: region === "left" ? 1.18 : 1,
          }}
          transition={{ type: "spring", stiffness: 420, damping: 24 }}
        >
          {leftIcon}
        </motion.span>
      ) : null}

      <motion.div
        className="min-w-0 flex-1"
        animate={{ opacity: isLifted ? 1 : 0.78, scale: isLifted ? 1.015 : 1 }}
        transition={{ type: "spring", stiffness: 360, damping: 26 }}
        onHoverStart={() => setIsHovering(true)}
        onHoverEnd={() => setIsHovering(false)}
      >
        <div
          id={id}
          ref={trackRef}
          role="slider"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-valuemin={safeMin}
          aria-valuemax={safeMax}
          aria-valuenow={safeValue}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            "relative h-8 min-w-[104px] touch-none select-none outline-hidden",
            disabled ? "cursor-not-allowed" : "cursor-ew-resize",
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={endPointer}
          onKeyDown={handleKeyDown}
        >
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2">
            <motion.div
              className="relative h-full rounded-full bg-(--w-08) shadow-inner ring-1 ring-(--w-10)"
              animate={{
                x:
                  region === "left"
                    ? -overflow * 0.28
                    : region === "right"
                      ? overflow * 0.28
                      : 0,
                scaleX: 1 + overflow / 160,
                scaleY: isLifted ? 1.55 : 1,
              }}
              style={{
                transformOrigin:
                  region === "left"
                    ? "right center"
                    : region === "right"
                      ? "left center"
                      : "center",
              }}
              transition={{ type: "spring", stiffness: 360, damping: 24 }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-(image:--accent-gradient) shadow-(--shadow-accent-glow)"
                style={{ width: `${percent}%` }}
              />
            </motion.div>
          </div>

          <motion.div
            className="absolute top-1/2"
            style={{
              left: `${percent}%`,
            }}
            animate={{
              scale: isActive ? 1.22 : isHovering ? 1.1 : 1,
            }}
            transition={{ type: "spring", stiffness: 520, damping: 26 }}
          >
            <div className="size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-(--w-40) bg-(--n-0) shadow-[0_8px_24px_var(--k-35),0_0_0_5px_var(--accent-14)]" />
          </motion.div>
        </div>
      </motion.div>

      {rightIcon ? (
        <motion.span
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center text-faint"
          animate={{
            x: region === "right" ? overflow * 0.32 : 0,
            scale: region === "right" ? 1.18 : 1,
          }}
          transition={{ type: "spring", stiffness: 420, damping: 24 }}
        >
          {rightIcon}
        </motion.span>
      ) : null}

      <span
        className={cn(
          "shrink-0 rounded-full border border-(--w-08) bg-(--w-04) px-2 py-0.5 text-right font-mono text-[11px] tabular-nums text-faint",
          valueWidthClassName,
        )}
      >
        {displayValue}
      </span>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapToStep(value: number, min: number, step: number) {
  const precision = decimalPlaces(step);
  const stepped = min + Math.round((value - min) / step) * step;
  return Number(stepped.toFixed(precision));
}

function decimalPlaces(value: number) {
  const [, decimals = ""] = String(value).split(".");
  return decimals.length;
}

function decay(value: number, max: number) {
  if (max === 0) return 0;
  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);
  return sigmoid * max;
}
