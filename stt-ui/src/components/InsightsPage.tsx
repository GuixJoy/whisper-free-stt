import { useState, useEffect, useCallback, useRef } from "react";
import TabSwitcher from "./TabSwitcher";
import StatsOverviewCard from "./StatsOverviewCard";
import UsageBreakdownCard from "./UsageBreakdownCard";
import HeatmapCard from "./HeatmapCard";
import StreakCard from "./StreakCard";
import type { StatItem, UsageCategory, HeatmapDay, StreakInfo } from "@/data/mockInsightsData";

const TABS = [
  { id: "usage", label: "Your Usage" },
  { id: "voice", label: "Your Voice" },
];

interface InsightsData {
  wpm: number;
  wpmTrend: number;
  totalWords: number;
  wordsTrend: number;
  aiFixes: number;
  categories: UsageCategory[];
  streak: StreakInfo;
  heatmap: HeatmapDay[];
}

function formatWords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

export default function InsightsPage() {
  const [activeTab, setActiveTab] = useState("usage");
  const [stats, setStats] = useState<StatItem[]>([]);
  const [categories, setCategories] = useState<UsageCategory[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [streak, setStreak] = useState<StreakInfo>({ current: 0, longest: 0 });
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  const loadInsights = useCallback(async () => {
    setLoading(true);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = await invoke<InsightsData>("get_insights");
        applyData(data);
      } else {
        // Use REST API
        const resp = await fetch("http://127.0.0.1:8765/api/insights");
        if (resp.ok) {
          const data = await resp.json();
          applyData(data);
        }
      }
    } catch {
      // Fallback to empty state
    } finally {
      setLoading(false);
    }
  }, []);

  const applyData = (data: InsightsData) => {
    setStats([
      { value: String(data.wpm || 0), label: "Words / Min", trend: data.wpmTrend ? { value: Math.abs(data.wpmTrend), direction: data.wpmTrend > 0 ? "up" : "down" } : undefined },
      { value: formatWords(data.totalWords || 0), label: "Total Words", trend: data.wordsTrend ? { value: Math.abs(data.wordsTrend), direction: data.wordsTrend > 0 ? "up" : "down" } : undefined },
      { value: String(data.aiFixes || 0), label: "AI Fixes" },
    ]);
    setCategories(data.categories || []);
    setHeatmap(data.heatmap || []);
    setStreak(data.streak || { current: 0, longest: 0 });
  };

  useEffect(() => {
    loadInsights();
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) wsRef.current.close();
    };
  }, [loadInsights]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <h1 className="text-[32px] font-semibold text-[#F7F4EE] mb-4">Insights</h1>
        <div className="flex items-center justify-center h-[400px] text-[#7A7F87]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <h1 className="text-[32px] font-semibold text-[#F7F4EE] mb-4">Insights</h1>

      <TabSwitcher tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "usage" && (
        <div className="flex flex-col gap-6 mt-6">
          <div className="flex gap-4">
            {stats.map((stat) => (
              <StatsOverviewCard key={stat.label} stat={stat} />
            ))}
          </div>
          <div className="flex gap-4">
            <UsageBreakdownCard categories={categories} />
            <StreakCard streak={streak} />
          </div>
          <HeatmapCard data={heatmap} />
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
