import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "accent" | "success" | "outline" | "plan";
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-badge px-3 py-1 text-label font-semibold",
          variant === "default" && "bg-app-surface border border-border text-text-primary",
          variant === "accent" && "bg-accent-muted border border-accent-muted-border text-accent-light",
          variant === "success" && "bg-success/10 text-success",
          variant === "outline" && "border border-border text-text-secondary",
          variant === "plan" && "bg-accent-muted border border-accent-muted-border text-accent-light text-[11px] px-2 py-0.5 h-6",
          className,
        )}
        {...props}
      />
    );
  },
);

Badge.displayName = "Badge";
