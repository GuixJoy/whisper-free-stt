import type { HeatmapDay } from "@/data/mockInsightsData";

interface HeatmapCardProps {
  data: HeatmapDay[];
}

const LEVEL_COLORS: Record<number, string> = {
  0: "#1A1D23",
  1: "#5A3A18",
  2: "#8C561F",
  3: "#C7772C",
  4: "#F6B15F",
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
        background: "#0F131A",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <h3 className="text-[16px] font-semibold text-[#F7F4EE] mb-4">
        Activity
      </h3>

      <div className="flex gap-[3px]">
        <div className="flex flex-col gap-[3px] mr-2 pt-[2px]">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="h-[13px] text-[11px] text-[#7A7F87] leading-[13px]"
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
        <span className="text-[11px] text-[#7A7F87] mr-1">Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className="w-[11px] h-[11px] rounded-[2px]"
            style={{ background: LEVEL_COLORS[level] }}
          />
        ))}
        <span className="text-[11px] text-[#7A7F87] ml-1">More</span>
      </div>
    </div>
  );
}
