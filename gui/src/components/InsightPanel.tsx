import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { StatsCard } from "./StatsCard";
import { ProfileCard } from "./ProfileCard";

interface InsightPanelProps extends React.HTMLAttributes<HTMLDivElement> {}

export const InsightPanel = forwardRef<HTMLDivElement, InsightPanelProps>(
  ({ className, ...props }, ref) => {
    const stats = [
      { value: "24.6K", label: "total words" },
      { value: "109", label: "wpm" },
      { value: "0", label: "day streak" },
    ];

    return (
      <div
        ref={ref}
        className={cn("flex flex-col gap-4 w-insight-width", className)}
        {...props}
      >
        <StatsCard stats={stats} />
        <ProfileCard progress={30} remainingText="Unlocks in 2K words" />
      </div>
    );
  },
);

InsightPanel.displayName = "InsightPanel";
