import { useEffect, useState } from "react";
import type { HeatmapDay } from "@/data/mockInsightsData";

interface HeatmapCardProps {
  data: HeatmapDay[];
}

const LEVEL_COLORS: Record<number, string> = {
  0: "#F6F3EF",
  1: "#FFECEF",
  2: "#FFD3DA",
  3: "#FFB2BE",
  4: "#FF3B56",
};

const WEEKDAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

export default function HeatmapCard({ data }: HeatmapCardProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const weeks: HeatmapDay[][] = [];
  for (let i = 0; i < data.length; i += 7) {
    weeks.push(data.slice(i, i + 7));
  }

  return (
    <div className="rounded-[14px] border border-border bg-white px-5 py-5 tabular-nums">
      <div className="mb-4">
        <h3 className="mb-1 text-[15px] font-semibold text-text-primary">
          Voice Activity Calendar
        </h3>
        <p className="text-[12px] text-text-muted">Your daily voice usage patterns</p>
      </div>

      <div className="flex gap-[3px]">
        <div className="mr-2 flex flex-col gap-[3px] pt-[2px]">
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} className="h-[13px] text-[11px] leading-[13px] text-text-muted">
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((day, di) => (
              <div
                key={di}
                className="h-[13px] w-[13px] rounded-[3px] transition duration-150 hover:scale-110 hover:ring-1 hover:ring-accent/30"
                style={{
                  background: LEVEL_COLORS[day.level] ?? LEVEL_COLORS[0],
                  opacity: isVisible ? 1 : 0,
                  transitionDelay: `${(wi * 7 + di) * 8}ms`,
                }}
                title={`${day.date}: Level ${day.level}`}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-end gap-1.5">
        <span className="mr-1 text-[11px] text-text-muted">Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="h-[11px] w-[11px] rounded-[2px]"
            style={{ background: LEVEL_COLORS[level] }}
          />
        ))}
        <span className="ml-1 text-[11px] text-text-muted">More</span>
      </div>
    </div>
  );
}
