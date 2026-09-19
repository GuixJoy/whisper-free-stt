import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

interface FloureSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  maxWidth?: string;
}

export const FloureSelect = forwardRef<HTMLSelectElement, FloureSelectProps>(
  ({ className, children, maxWidth = "max-w-[160px]", ...props }, ref) => {
    return (
      <div className={cn("relative", maxWidth)}>
        <select
          ref={ref}
          className={cn(
            "w-full h-[30px] pl-2.5 pr-7 rounded-[8px] bg-app-surface-secondary",
            "border border-border text-[12px] text-text-primary",
            "appearance-none cursor-pointer",
            "focus:outline-none focus:border-accent focus:bg-accent-focus-surface",
            "transition-colors duration-150",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
        />
      </div>
    );
  },
);

FloureSelect.displayName = "FloureSelect";
