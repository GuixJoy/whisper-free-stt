import { Flame } from "lucide-react";
import type { StreakInfo } from "@/data/mockInsightsData";

interface StreakCardProps {
  streak: StreakInfo;
}

export default function StreakCard({ streak }: StreakCardProps) {
  return (
    <div
      className="flex-1 min-w-[200px] rounded-[24px] p-6"
      style={{
        background: "#F3F0EB",
        border: "1px solid rgba(44,37,32,0.08)",
      }}
    >
      <h3 className="text-[16px] font-semibold text-text-primary mb-5">
        Streaks
      </h3>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-[12px] bg-border">
            <Flame size={20} className="text-accent" />
          </div>
          <div>
            <div className="text-[13px] text-text-muted">Current Streak</div>
            <div className="text-[24px] font-bold text-sunset leading-tight">
              {streak.current} days
            </div>
          </div>
        </div>
        <div className="h-px bg-border-hover" />
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-[12px] bg-border">
            <Flame size={20} className="text-text-muted" />
          </div>
          <div>
            <div className="text-[13px] text-text-muted">Longest Streak</div>
            <div className="text-[24px] font-bold text-text-primary leading-tight">
              {streak.longest} days
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
