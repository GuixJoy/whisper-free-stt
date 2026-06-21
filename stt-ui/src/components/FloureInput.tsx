import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface FloureInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  maxWidth?: string;
}

export const FloureInput = forwardRef<HTMLInputElement, FloureInputProps>(
  ({ className, maxWidth = "max-w-[200px]", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-[36px] px-3 rounded-[10px] bg-app-surface-secondary",
          "border border-border text-[13px] text-text-primary",
          "placeholder:text-text-disabled",
          "focus:outline-none focus:border-accent focus:bg-accent-focus-surface",
          "transition-colors duration-150",
          maxWidth,
          className,
        )}
        {...props}
      />
    );
  },
);

FloureInput.displayName = "FloureInput";
