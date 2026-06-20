import type { UsageCategory } from "@/data/mockInsightsData";

interface UsageBreakdownCardProps {
  categories: UsageCategory[];
}

export default function UsageBreakdownCard({ categories }: UsageBreakdownCardProps) {
  return (
    <div
      className="flex-1 min-w-[300px] rounded-[24px] p-6"
      style={{
        background: "#F3F0EB",
        border: "1px solid rgba(44,37,32,0.08)",
      }}
    >
      <h3 className="text-[16px] font-semibold text-text-primary mb-5">
        Usage Breakdown
      </h3>
      <div className="flex flex-col gap-4">
        {categories.map((cat) => {
          const pct = Math.round((cat.words / cat.maxWords) * 100);
          return (
            <div key={cat.name}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[14px] text-text-secondary">{cat.name}</span>
                <span className="text-[13px] text-text-muted">
                  {cat.words.toLocaleString()} words
                </span>
              </div>
              <div className="h-[6px] rounded-full bg-border-hover overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: "linear-gradient(90deg, #3B6B9E, #D4883A)",
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
