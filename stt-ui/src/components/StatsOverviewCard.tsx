import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { StatItem } from "@/data/mockInsightsData";

interface StatsOverviewCardProps {
  stat: StatItem;
  accent?: boolean;
}

export default function StatsOverviewCard({ stat, accent }: StatsOverviewCardProps) {
  const trendIcon = stat.trend?.direction === "up"
    ? <TrendingUp size={12} />
    : stat.trend?.direction === "down"
      ? <TrendingDown size={12} />
      : <Minus size={12} />;

  const trendColor = stat.trend?.direction === "up"
    ? "text-accent"
    : stat.trend?.direction === "down"
      ? "text-red-500"
      : "text-text-muted";

  return (
    <div
      className={cn(
        "rounded-[14px] border px-5 py-4 min-h-[120px]",
        accent
          ? "bg-accent-surface border-accent/20"
          : "bg-white border-border",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-text-muted font-medium uppercase tracking-wide">{stat.label}</span>
        {stat.trend && (
          <span className={cn("flex items-center gap-0.5 text-[11px] font-medium", trendColor)}>
            {trendIcon}
            {stat.trend.value}%
          </span>
        )}
      </div>
      <div className={cn("text-[28px] font-bold leading-none tracking-tight", accent ? "text-accent" : "text-text-primary")}>
        {stat.value}
      </div>
    </div>
  );
}
