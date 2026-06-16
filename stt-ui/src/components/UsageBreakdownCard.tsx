import type { UsageCategory } from "@/data/mockInsightsData";

interface UsageBreakdownCardProps {
  categories: UsageCategory[];
}

export default function UsageBreakdownCard({ categories }: UsageBreakdownCardProps) {
  return (
    <div
      className="flex-1 min-w-[300px] rounded-[24px] p-6"
      style={{
        background: "#0F131A",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <h3 className="text-[16px] font-semibold text-[#F7F4EE] mb-5">
        Usage Breakdown
      </h3>
      <div className="flex flex-col gap-4">
        {categories.map((cat) => {
          const pct = Math.round((cat.words / cat.maxWords) * 100);
          return (
            <div key={cat.name}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[14px] text-[#A8A096]">{cat.name}</span>
                <span className="text-[13px] text-[#7A7F87]">
                  {cat.words.toLocaleString()} words
                </span>
              </div>
              <div className="h-[6px] rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, #C7772C, #F6B15F)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
