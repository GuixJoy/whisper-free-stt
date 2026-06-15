import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Card } from "./Card";

interface StatItem {
  value: string;
  label: string;
}

interface StatsCardProps extends React.HTMLAttributes<HTMLDivElement> {
  stats: StatItem[];
}

export const StatsCard = forwardRef<HTMLDivElement, StatsCardProps>(
  ({ className, stats, ...props }, ref) => {
    return (
      <Card
        ref={ref}
        variant="stats"
        className={cn("p-6", className)}
        {...props}
      >
        <div className="flex flex-col gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="flex items-baseline gap-2">
              <span className="stat-value text-[52px] font-bold">
                {stat.value}
              </span>
              <span className="text-[18px] text-text-secondary">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </Card>
    );
  },
);

StatsCard.displayName = "StatsCard";
