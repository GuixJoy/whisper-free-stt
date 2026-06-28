import { useState, useEffect, useCallback, useRef } from "react";
import TabSwitcher from "./TabSwitcher";
import VoiceActivityGraph from "./VoiceActivityGraph";
import UsageDistribution from "./UsageDistribution";
import HeatmapCard from "./HeatmapCard";
import StreakJourney from "./StreakJourney";
import VoiceIntelligence from "./VoiceIntelligence";
import type { UsageCategory, HeatmapDay, StreakInfo } from "@/data/mockInsightsData";

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
  weeklyWords: { label: string; words: number }[];
}

const REFRESH_INTERVAL_MS = 10_000;

function formatWords(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

/** Derive weekly bar chart data from heatmap (last 7 days) */
function heatmapToWeekly(heatmap: HeatmapDay[]): { label: string; value: number }[] {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = new Date();
  const result: { label: string; value: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const entry = heatmap.find((h) => h.date === key);
    result.push({
      label: days[d.getDay()],
      // Use level as rough proxy; real word count not stored per-day in heatmap
      value: entry ? entry.level * 300 + 200 : 0,
    });
  }
  return result;
}

export default function InsightsPage() {
  const [activeTab, setActiveTab] = useState("usage");
  const [categories, setCategories] = useState<UsageCategory[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapDay[]>([]);
  const [streak, setStreak] = useState<StreakInfo>({ current: 0, longest: 0 });
  const [totalWords, setTotalWords] = useState(0);
  const [wordsTrend, setWordsTrend] = useState(0);
  const [weeklyData, setWeeklyData] = useState<{ label: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const loadInsights = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = await invoke<InsightsData>("get_insights");
        if (!mountedRef.current) return;
        applyData(data);
      } else {
        const resp = await fetch("http://127.0.0.1:8765/api/insights");
        if (resp.ok) {
          const data = await resp.json();
          if (!mountedRef.current) return;
          applyData(data);
        }
      }
    } catch (e) {
      console.warn("[Insights] Failed to load analytics:", e);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const applyData = (data: InsightsData) => {
    setTotalWords(data.totalWords || 0);
    setWordsTrend(data.wordsTrend || 0);
    setCategories(data.categories || []);
    setHeatmap(data.heatmap || []);
    setStreak(data.streak || { current: 0, longest: 0 });
    const weekly = (data.weeklyWords || []).map(w => ({ label: w.label, value: w.words }));
    setWeeklyData(weekly.length > 0 ? weekly : heatmapToWeekly(data.heatmap || []));
  };

  // Initial load + auto-refresh every 10s
  useEffect(() => {
    mountedRef.current = true;
    loadInsights(true);
    const interval = setInterval(() => loadInsights(false), REFRESH_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [loadInsights]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="flex items-center justify-center h-[400px] text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="flex-1 px-8 py-6 max-w-[1200px] mx-auto w-full">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-[22px] font-semibold text-text-primary mb-1">Insights</h1>
          <p className="text-[13px] text-text-muted">Your voice productivity story.</p>
        </div>

        <TabSwitcher tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === "usage" && (
          <div className="mt-6 flex flex-col gap-5">
            {/* Section 1 — Voice Activity Story */}
            <div className="rounded-[14px] bg-white border border-border px-6 py-6">
              <div className="mb-2">
                <h2 className="text-[18px] font-semibold text-text-primary mb-1">Voice Activity</h2>
                <p className="text-[13px] text-text-muted">
                  This week you dictated{" "}
                  <span className="font-semibold text-[#3B6B9E]">{formatWords(totalWords)} words</span>
                  {wordsTrend > 0 && (
                    <span className="text-accent ml-1">
                      ↑ {wordsTrend}% more than last week
                    </span>
                  )}
                </p>
              </div>
              <VoiceActivityGraph
                data={weeklyData}
              />
            </div>

            {/* Section 2 — Usage Distribution + Streak Journey */}
            <div className="grid grid-cols-2 gap-5 items-start">
              <UsageDistribution categories={categories} />
              <StreakJourney streak={streak} />
            </div>

            {/* Section 3 — Activity Heatmap */}
            <HeatmapCard data={heatmap} />

            {/* Section 4 — Voice Intelligence */}
            <VoiceIntelligence />
          </div>
        )}

        {activeTab === "voice" && (
          <div className="mt-6 flex flex-col gap-5">
            {/* Voice Intelligence — Full Width */}
            <VoiceIntelligence />
          </div>
        )}
      </div>
    </div>
  );
}
