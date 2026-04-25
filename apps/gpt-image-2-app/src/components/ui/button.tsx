import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";

const button = cva(
  "relative inline-flex items-center gap-1.5 font-medium leading-none whitespace-nowrap border rounded-full border-transparent transition-[background,border-color,color,box-shadow,transform] duration-150 select-none disabled:opacity-45 disabled:cursor-not-allowed active:translate-y-[0.5px]",
  {
    variants: {
      variant: {
        // Brand primary — liquid gradient fill (violet → cyan)
        primary:
          "text-white border-[rgba(167,139,250,0.5)] shadow-[0_8px_24px_-8px_rgba(167,139,250,0.55),inset_0_1px_0_rgba(255,255,255,0.18)] hover:border-[rgba(167,139,250,0.75)]",
        // Glass secondary — soft surface, used everywhere as default
        secondary:
          "bg-[rgba(255,255,255,0.05)] text-foreground border-border hover:bg-[rgba(255,255,255,0.09)] hover:border-border-strong",
        // Ghost — completely transparent, just hover hint
        ghost:
          "bg-transparent text-foreground border-transparent hover:bg-[rgba(255,255,255,0.06)]",
        // Danger — subtle red tint
        danger:
          "bg-[rgba(248,113,113,0.08)] text-status-err border-[rgba(248,113,113,0.25)] hover:bg-[rgba(248,113,113,0.16)]",
        // Solid dark — for "新建生成" CTA in toolbar
        solidDark:
          "bg-white text-[#06060a] border-white hover:bg-white/90",
      },
      size: {
        sm: "h-8 px-3.5 text-[12.5px]",
        md: "h-9 px-4 text-[13px]",
        lg: "h-11 px-5 text-[14px]",
        icon: "w-9 h-9 p-0 justify-center",
        iconSm: "w-8 h-8 p-0 justify-center",
      },
      active: {
        true: "bg-[rgba(255,255,255,0.10)]",
        false: "",
      },
    },
    compoundVariants: [
      { variant: "ghost", active: true, class: "bg-[rgba(255,255,255,0.10)]" },
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
                backgroundImage:
                  "linear-gradient(135deg, rgba(167,139,250,0.95) 0%, rgba(103,232,249,0.92) 100%)",
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
