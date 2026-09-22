import { useEffect, useState } from "react";
import type { UsageCategory } from "@/data/mockInsightsData";

interface UsageDistributionProps {
  categories: UsageCategory[];
}

const COLORS = ["#3B6B9E", "#A88CC8", "#FF3B56", "#D4883A", "#6B9E7A"];

export default function UsageDistribution({ categories }: UsageDistributionProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const total = categories.reduce((sum, c) => sum + c.words, 0) || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeWidth = 6;
  const size = 110;

  let accumulatedPct = 0;

  return (
    <div className="rounded-[14px] border border-border bg-white px-5 py-5">
      <h3 className="mb-5 text-[15px] font-semibold text-text-primary">Usage Mix</h3>

      <div className="flex items-center gap-8">
        {/* Donut chart */}
        <div className="flex-shrink-0" style={{ width: size, height: size }}>
          <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="rgba(44,37,32,0.06)"
              strokeWidth={strokeWidth}
            />
            {categories.map((cat, i) => {
              const pct = cat.words / total;
              const dashLen = circumference * pct;
              const dashOffset = circumference * accumulatedPct;
              accumulatedPct += pct;

              return (
                <circle
                  key={cat.name}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={strokeWidth}
                  strokeLinecap="round"
                  strokeDasharray={`${isVisible ? dashLen : 0} ${circumference - dashLen}`}
                  strokeDashoffset={-dashOffset}
                  style={{
                    transition: `stroke-dasharray 800ms ease-out ${i * 150}ms`,
                  }}
                />
              );
            })}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex flex-1 flex-col gap-2.5">
          {categories.map((cat, i) => {
            const pct = Math.round((cat.words / total) * 100);
            return (
              <div key={cat.name} className="flex items-center gap-2.5">
                <div
                  className="h-[8px] w-[8px] flex-shrink-0 rounded-full"
                  style={{ background: COLORS[i % COLORS.length] }}
                />
                <span className="flex-1 text-[12px] text-text-secondary">{cat.name}</span>
                <span className="text-[12px] font-medium tabular-nums text-text-primary">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
