import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";

const button = cva(
  "relative inline-flex items-center gap-1.5 font-medium leading-none whitespace-nowrap border rounded-full border-transparent transition-[background,border-color,color,box-shadow,transform] duration-150 select-none disabled:opacity-40 disabled:saturate-50 disabled:cursor-not-allowed active:translate-y-[0.5px] active:scale-[0.985]",
  {
    variants: {
      variant: {
        // Brand primary — liquid gradient fill (violet → cyan).
        // Hover lifts the glow, press fires a one-shot accent ring as a
        // tactile "click registered" cue (--shadow-accent-glow-press).
        primary:
          "text-foreground border-[color:var(--accent-50)] shadow-[var(--shadow-accent-glow)] hover:border-[color:var(--accent-75)] hover:shadow-[var(--shadow-accent-glow-hover)] active:shadow-[var(--shadow-accent-glow-press)]",
        // Glass secondary — soft surface, used everywhere as default
        secondary:
          "bg-[color:var(--w-05)] text-foreground border-border hover:bg-[color:var(--w-10)] hover:border-border-strong",
        // Ghost — completely transparent, just hover hint
        ghost:
          "bg-transparent text-foreground border-transparent hover:bg-[color:var(--w-06)]",
        // Danger — subtle red tint
        danger:
          "bg-[color:var(--status-err-08)] text-status-err border-[color:var(--status-err-25)] hover:bg-[color:var(--status-err-bg)]",
        // Solid inverted — soft white CTA (used by "新建生成" toolbar action)
        solidDark:
          "bg-[color:var(--surface-inverted)] text-[color:var(--text-on-inverted)] border-[color:var(--surface-inverted)] hover:bg-[color:var(--surface-inverted-hover)]",
      },
      size: {
        sm: "h-8 px-3.5 text-[12.5px]",
        md: "h-9 px-4 text-[13px]",
        lg: "h-11 px-5 text-[14px]",
        icon: "w-9 h-9 p-0 justify-center",
        iconSm: "w-8 h-8 p-0 justify-center",
      },
      active: {
        true: "bg-[color:var(--w-10)]",
        false: "",
      },
    },
    compoundVariants: [
      { variant: "ghost", active: true, class: "bg-[color:var(--w-10)]" },
    ],
    defaultVariants: { variant: "secondary", size: "md", active: false },
  },
);

type Props = {
  icon?: IconName;
  iconRight?: IconName;
  kbd?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export const Button = forwardRef<HTMLButtonElement, Props>(
  (
    {
      variant,
      size,
      active,
      icon,
      iconRight,
      kbd,
      className,
      children,
      style,
      type = "button",
      ...rest
    },
    ref,
  ) => {
    const iconSize = size === "sm" ? 13 : 15;
    const isPrimary = variant === "primary";
    return (
      <button
        ref={ref}
        type={type}
        className={cn(button({ variant, size, active }), className)}
        style={
          isPrimary
            ? {
                backgroundImage: "var(--accent-gradient-fill)",
                ...style,
              }
            : style
        }
        {...rest}
      >
        {icon && <Icon name={icon} size={iconSize} />}
        {children}
        {iconRight && <Icon name={iconRight} size={iconSize} />}
        {kbd && <span className="kbd ml-1">{kbd}</span>}
      </button>
    );
  },
);

Button.displayName = "Button";
