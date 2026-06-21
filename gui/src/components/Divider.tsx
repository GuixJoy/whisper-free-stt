import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Divider = forwardRef<HTMLDivElement, DividerProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("h-px bg-white/[0.04]", className)}
        {...props}
      />
    );
  },
);

Divider.displayName = "Divider";
