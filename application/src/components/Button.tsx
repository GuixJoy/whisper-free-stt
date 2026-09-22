import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "ghost";
  size?: "default" | "sm";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-button font-medium transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          "disabled:pointer-events-none disabled:opacity-50",
          variant === "default" &&
            "border border-border bg-app-surface text-text-primary hover:bg-app-hover",
          variant === "primary" && "bg-accent text-white shadow-accent-button hover:bg-accent-warm",
          variant === "ghost" && "text-text-secondary hover:bg-app-hover",
          size === "default" && "h-11 px-4 py-2 text-body",
          size === "sm" && "h-8 px-3 text-small",
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
