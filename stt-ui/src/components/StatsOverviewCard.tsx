import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { StatItem } from "@/data/mockInsightsData";

interface StatsOverviewCardProps {
  stat: StatItem;
}

export default function StatsOverviewCard({ stat }: StatsOverviewCardProps) {
  const trendIcon = stat.trend?.direction === "up"
    ? <TrendingUp size={14} />
    : stat.trend?.direction === "down"
      ? <TrendingDown size={14} />
      : <Minus size={14} />;

  const trendColor = stat.trend?.direction === "up"
    ? "text-[#C7772C]"
    : stat.trend?.direction === "down"
      ? "text-[#EF4444]"
      : "text-[#7A7F87]";

  return (
    <div
      className="flex-1 min-w-[200px] rounded-[24px] p-6"
      style={{
        background: "#0F131A",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-[14px] text-[#7A7F87]">{stat.label}</span>
        {stat.trend && (
          <span className={cn("flex items-center gap-1 text-[13px] font-medium", trendColor)}>
            {trendIcon}
            {stat.trend.value}%
          </span>
        )}
      </div>
      <div
        className="text-[42px] font-bold leading-none"
        style={{ color: "#F6B15F" }}
      >
        {stat.value}
      </div>
    </div>
  );
}
