import { forwardRef } from "react";
import { cn } from "@/lib/utils";

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
      <div
        ref={ref}
        className={cn(
          "relative rounded-card p-6 overflow-hidden border border-border",
          className,
        )}
        {...props}
      >
        {/* Background layers */}
        <div className="absolute inset-0 bg-app-surface-card" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(255,59,86,0.08),transparent_65%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_90%_90%,rgba(50,120,130,0.08),transparent_60%)]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col gap-4">
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
      </div>
    );
  },
);

StatsCard.displayName = "StatsCard";
