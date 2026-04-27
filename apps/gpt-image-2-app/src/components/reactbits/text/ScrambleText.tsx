// In-house take on reactbits's ScrambledText. The upstream version
// pulls gsap + the SplitText plugin (a paid GSAP Club plugin), which
// we don't license. This 50-line equivalent uses RAF + Math.random
// to scramble each glyph for a brief reveal, replayable by changing
// the `trigger` prop. Used by AboutPanel for the "path copied" cue
// — meant to be cheap and one-shot, not a hero animation.
import { useEffect, useState } from "react";

const DEFAULT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";

interface ScrambleTextProps {
  /** Final text to settle on. */
  text: string;
  /** Increment to replay the scramble (e.g. on copy). */
  trigger?: number;
  /** Total reveal duration in ms. */
  duration?: number;
  /** Pool of characters drawn for the noise phase. */
  scrambleChars?: string;
  className?: string;
}

export default function ScrambleText({
  text,
  trigger = 0,
  duration = 600,
  scrambleChars = DEFAULT_CHARS,
  className = "",
}: ScrambleTextProps) {
  const [output, setOutput] = useState(text);

  useEffect(() => {
    // Don't animate on first mount — only when trigger changes. The
    // initial render shows the plain text instantly so paths in the
    // About panel are readable on entry.
    if (trigger === 0) {
      setOutput(text);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const target = text;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const reveal = Math.floor(target.length * progress);
      let s = "";
      for (let i = 0; i < target.length; i++) {
        const ch = target[i];
        if (i < reveal || ch === " " || ch === "/" || ch === ".") {
          s += ch;
        } else {
          s += scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
        }
      }
      setOutput(s);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      } else {
        setOutput(target);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, trigger, duration, scrambleChars]);

  return <span className={className}>{output}</span>;
}
