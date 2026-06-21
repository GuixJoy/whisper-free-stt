import type { HeatmapDay } from "@/data/mockInsightsData";

interface HeatmapCardProps {
  data: HeatmapDay[];
}

const LEVEL_COLORS: Record<number, string> = {
  0: "#EDE9E3",
  1: "#C4C0BA",
  2: "#9C9590",
  3: "#FF3B56",
  4: "#D4883A",
};

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

export default function HeatmapCard({ data }: HeatmapCardProps) {
  const weeks: HeatmapDay[][] = [];
  for (let i = 0; i < data.length; i += 7) {
    weeks.push(data.slice(i, i + 7));
  }

  return (
    <div
      className="rounded-[24px] p-6"
      style={{
        background: "#F3F0EB",
        border: "1px solid rgba(44,37,32,0.08)",
      }}
    >
      <h3 className="text-[16px] font-semibold text-text-primary mb-4">
        Activity
      </h3>

      <div className="flex gap-[3px]">
        <div className="flex flex-col gap-[3px] mr-2 pt-[2px]">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="h-[13px] text-[11px] text-text-muted leading-[13px]"
            >
              {label}
            </div>
          ))}
        </div>

        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {week.map((day, di) => (
              <div
                key={di}
                className="w-[13px] h-[13px] rounded-[3px] transition-colors"
                style={{ background: LEVEL_COLORS[day.level] ?? LEVEL_COLORS[0] }}
                title={`${day.date}: Level ${day.level}`}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-1.5 mt-4">
        <span className="text-[11px] text-text-muted mr-1">Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="w-[11px] h-[11px] rounded-[2px]"
            style={{ background: LEVEL_COLORS[level] }}
          />
        ))}
        <span className="text-[11px] text-text-muted ml-1">More</span>
      </div>
    </div>
  );
}
