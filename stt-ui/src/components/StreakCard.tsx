import { Flame, Trophy } from "lucide-react";
import type { StreakInfo } from "@/data/mockInsightsData";

interface StreakCardProps {
  streak: StreakInfo;
}

const MILESTONES = [3, 7, 14, 30, 60, 90];

export default function StreakCard({ streak }: StreakCardProps) {
  const nextMilestone = MILESTONES.find((m) => m > streak.current) ?? MILESTONES[MILESTONES.length - 1];
  const progress = Math.min((streak.current / nextMilestone) * 100, 100);

  return (
    <div className="rounded-[14px] bg-white border border-border px-5 py-4 min-h-[180px]">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-app-surface-secondary">
          <Flame size={14} className="text-accent" />
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">Streaks</span>
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">Consistency is key</span>
        </div>
      </div>

      {/* Current Streak */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[32px] font-bold text-accent leading-none">{streak.current}</span>
          <span className="text-[12px] text-text-muted">days</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <Trophy size={12} className="text-text-muted" />
          Best: {streak.longest} days
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-text-muted">Next milestone</span>
          <span className="text-[11px] text-text-secondary font-medium">{nextMilestone} days</span>
        </div>
        <div className="h-[6px] rounded-full bg-border-hover overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Milestone Timeline */}
      <div className="flex items-center gap-1">
        {MILESTONES.map((m) => (
          <div
            key={m}
            className={`flex items-center justify-center h-[20px] px-1.5 rounded-[4px] text-[10px] font-medium transition-colors ${
              streak.current >= m
                ? "bg-accent-surface text-accent"
                : "bg-border-hover text-text-muted"
            }`}
          >
            {m}
          </div>
        ))}
      </div>
    </div>
  );
}
