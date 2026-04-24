import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/icon";

const button = cva(
  "inline-flex items-center gap-1.5 font-medium leading-none whitespace-nowrap border rounded-md border-transparent transition-[background,border-color,color] duration-100 select-none disabled:opacity-45 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary: "bg-accent text-[color:var(--accent-on)] border-[color:var(--accent)] hover:bg-accent-hover",
        secondary: "bg-raised text-foreground border-border hover:bg-hover",
        ghost: "bg-transparent text-foreground hover:bg-hover",
        danger: "bg-raised text-status-err border-border hover:bg-status-err-bg",
        solidDark: "bg-[color:var(--n-900)] text-[color:var(--n-0)] border-[color:var(--n-900)] hover:bg-[color:var(--n-700)]",
      },
      size: {
        sm: "h-[26px] px-2.5 text-[12.5px]",
        md: "h-8 px-3 text-[13px]",
        lg: "h-10 px-4 text-[14px]",
        icon: "w-[30px] h-[30px] p-0 justify-center",
        iconSm: "w-6 h-6 p-0 justify-center",
      },
      active: {
        true: "bg-pressed",
        false: "",
      },
    },
    compoundVariants: [
      { variant: "ghost", active: true, class: "bg-pressed" },
    ],
    defaultVariants: { variant: "secondary", size: "md", active: false },
  }
);

type Props = {
  icon?: IconName;
  iconRight?: IconName;
  kbd?: ReactNode;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button>;

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant, size, active, icon, iconRight, kbd, className, children, type = "button", ...rest }, ref) => {
    const iconSize = size === "sm" ? 13 : 15;
    return (
      <button ref={ref} type={type} className={cn(button({ variant, size, active }), className)} {...rest}>
        {icon && <Icon name={icon} size={iconSize} />}
        {children}
        {iconRight && <Icon name={iconRight} size={iconSize} />}
        {kbd && <span className="kbd ml-1">{kbd}</span>}
      </button>
    );
  }
);

Button.displayName = "Button";
