import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "surface" | "sidebar" | "stats" | "activity" | "upgrade";
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-card",
          variant === "default" && "bg-app-surface border border-border",
          variant === "surface" && "bg-app-surface-card border border-border-accent",
          variant === "sidebar" && "bg-app-sidebar",
          variant === "stats" && "bg-app-surface-card border border-border-accent",
          variant === "activity" && "bg-app-surface-dark border border-border",
          variant === "upgrade" && "bg-app-surface border border-border-accent",
          className,
        )}
        {...props}
      />
    );
  },
);

Card.displayName = "Card";
