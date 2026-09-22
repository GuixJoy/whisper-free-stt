import { useEffect, useState } from "react";
import { Flame, Trophy } from "lucide-react";
import type { StreakInfo } from "@/data/mockInsightsData";

interface StreakJourneyProps {
  streak: StreakInfo;
}

const MILESTONES = [3, 7, 14, 30, 60, 90];

export default function StreakJourney({ streak }: StreakJourneyProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const nextMilestone =
    MILESTONES.find((m) => m > streak.current) ?? MILESTONES[MILESTONES.length - 1];
  const progress = Math.min((streak.current / nextMilestone) * 100, 100);

  return (
    <div className="rounded-[14px] border border-border bg-white px-5 py-5">
      <div className="mb-5">
        <h3 className="mb-1 text-[15px] font-semibold text-text-primary">Streaks</h3>
        <p className="text-[12px] text-text-muted">Consistency builds mastery</p>
      </div>

      {/* Current Streak */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-accent-surface">
            <Flame size={20} className="text-accent" />
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-text-muted">
              Current Streak
            </div>
            <div className="text-[28px] font-bold leading-tight text-accent">
              {streak.current} days
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
          <Trophy size={13} className="text-text-muted" />
          Best: {streak.longest} days
        </div>
      </div>

      {/* Progress to next milestone */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] text-text-muted">Next milestone</span>
          <span className="text-[12px] font-medium text-text-primary">{nextMilestone} days</span>
        </div>
        <div className="h-[6px] overflow-hidden rounded-full bg-border-hover">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-out"
            style={{
              width: isVisible ? `${progress}%` : "0%",
            }}
          />
        </div>
      </div>

      {/* Milestone Timeline */}
      <div className="relative">
        {/* Progress line */}
        <div className="absolute left-0 right-0 top-[14px] h-[2px] bg-border-hover">
          <div
            className="h-full bg-accent transition-[width] duration-1000 ease-out"
            style={{
              width: isVisible
                ? `${(streak.current / MILESTONES[MILESTONES.length - 1]) * 100}%`
                : "0%",
            }}
          />
        </div>

        {/* Milestone dots */}
        <div className="relative flex items-center justify-between">
          {MILESTONES.map((m) => {
            const achieved = streak.current >= m;
            return (
              <div key={m} className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-[28px] w-[28px] items-center justify-center rounded-full text-[11px] font-semibold transition-colors duration-500 ${
                    achieved ? "bg-accent text-white" : "bg-border-hover text-text-muted"
                  }`}
                >
                  {m}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
