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
        background: "#0F131A",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <h3 className="text-[16px] font-semibold text-[#F7F4EE] mb-5">
        Streaks
      </h3>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-[12px] bg-white/[0.04]">
            <Flame size={20} className="text-[#C7772C]" />
          </div>
          <div>
            <div className="text-[13px] text-[#7A7F87]">Current Streak</div>
            <div className="text-[24px] font-bold text-[#F6B15F] leading-tight">
              {streak.current} days
            </div>
          </div>
        </div>
        <div className="h-px bg-white/[0.06]" />
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-[12px] bg-white/[0.04]">
            <Flame size={20} className="text-[#7A7F87]" />
          </div>
          <div>
            <div className="text-[13px] text-[#7A7F87]">Longest Streak</div>
            <div className="text-[24px] font-bold text-[#F7F4EE] leading-tight">
              {streak.longest} days
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
