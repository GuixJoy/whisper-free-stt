import type { UsageCategory } from "@/data/mockInsightsData";

interface UsageBreakdownCardProps {
  categories: UsageCategory[];
}

export default function UsageBreakdownCard({ categories }: UsageBreakdownCardProps) {
  const maxWords = Math.max(...categories.map((c) => c.words), 1);

  return (
    <div className="rounded-[14px] bg-white border border-border px-5 py-4 min-h-[180px]">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-app-surface-secondary">
          <span className="text-[13px]">📊</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">Usage Trend</span>
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">Words per category this week</span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {categories.map((cat) => {
          const pct = Math.round((cat.words / maxWords) * 100);
          return (
            <div key={cat.name} className="flex items-center gap-3">
              <span className="text-[12px] text-text-secondary w-[90px] text-right truncate">{cat.name}</span>
              <div className="flex-1 h-[8px] rounded-full bg-border-hover overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-text-muted w-[50px] text-right">{(cat.words / 1000).toFixed(1)}K</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
