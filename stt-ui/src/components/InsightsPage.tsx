import { useState } from "react";
import TabSwitcher from "./TabSwitcher";
import StatsOverviewCard from "./StatsOverviewCard";
import UsageBreakdownCard from "./UsageBreakdownCard";
import HeatmapCard from "./HeatmapCard";
import StreakCard from "./StreakCard";
import {
  mockStats,
  mockUsageCategories,
  mockHeatmap,
  mockStreak,
} from "@/data/mockInsightsData";

const TABS = [
  { id: "usage", label: "Your Usage" },
  { id: "voice", label: "Your Voice" },
];

export default function InsightsPage() {
  const [activeTab, setActiveTab] = useState("usage");

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <h1 className="text-[32px] font-semibold text-[#F7F4EE] mb-4">
        Insights
      </h1>

      <TabSwitcher tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "usage" && (
        <div className="flex flex-col gap-6 mt-6">
          {/* Stats Row */}
          <div className="flex gap-4">
            {mockStats.map((stat) => (
              <StatsOverviewCard key={stat.label} stat={stat} />
            ))}
          </div>

          {/* Usage + Streak Row */}
          <div className="flex gap-4">
            <UsageBreakdownCard categories={mockUsageCategories} />
            <StreakCard streak={mockStreak} />
          </div>

          {/* Heatmap */}
          <HeatmapCard data={mockHeatmap} />
        </div>
      )}

      {activeTab === "voice" && (
        <div className="flex items-center justify-center h-[400px] text-[#7A7F87] text-[15px]">
          Voice insights coming soon.
        </div>
      )}
    </div>
  );
}
