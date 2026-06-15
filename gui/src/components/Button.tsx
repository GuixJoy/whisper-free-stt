import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost" | "accent" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-button font-medium transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          "disabled:pointer-events-none disabled:opacity-50",
          variant === "default" && "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
          variant === "primary" && "bg-accent text-white hover:bg-accent-warm shadow-accent-button",
          variant === "ghost" && "hover:bg-app-hover text-text-secondary",
          variant === "accent" && "bg-accent text-white hover:bg-accent-warm shadow-accent-button",
          variant === "secondary" && "bg-white/[0.04] border border-white/[0.08] text-text-primary hover:bg-white/[0.08]",
          size === "default" && "h-11 px-4 py-2 text-body",
          size === "sm" && "h-8 px-3 text-small",
          size === "lg" && "h-12 px-6 text-body",
          size === "icon" && "h-10 w-10",
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
