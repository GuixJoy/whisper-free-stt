import { useState, useEffect } from "react";
import { Calendar, Clock, Timer, Globe } from "lucide-react";

interface InsightItem {
  icon: React.ElementType;
  label: string;
  value: string;
  detail?: string;
  color: string;
}

interface IntelligenceData {
  mostActiveDay: string;
  mostProductiveHour: string;
  avgDictationLength: string;
  mostUsedLanguage: string;
  mostActiveDayWords: number;
  peakVoiceUsage: string;
  perUtterance: string;
  languagePercentage: number;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

function defaultData(): IntelligenceData {
  return {
    mostActiveDay: "—",
    mostProductiveHour: "—",
    avgDictationLength: "—",
    mostUsedLanguage: "—",
    mostActiveDayWords: 0,
    peakVoiceUsage: "No sessions",
    perUtterance: "No data",
    languagePercentage: 0,
  };
}

function buildInsights(data: IntelligenceData): InsightItem[] {
  return [
    {
      icon: Calendar,
      label: "Most Active Day",
      value: data.mostActiveDay,
      detail: data.mostActiveDayWords > 0 ? `Average ${data.mostActiveDayWords.toLocaleString()} words` : undefined,
      color: "text-[#3B6B9E]",
    },
    {
      icon: Clock,
      label: "Most Productive Hour",
      value: data.mostProductiveHour,
      detail: data.peakVoiceUsage,
      color: "text-[#A88CC8]",
    },
    {
      icon: Timer,
      label: "Avg Dictation Length",
      value: data.avgDictationLength,
      detail: data.perUtterance,
      color: "text-accent",
    },
    {
      icon: Globe,
      label: "Most Used Language",
      value: data.mostUsedLanguage,
      detail: data.languagePercentage > 0 ? `${data.languagePercentage}% of sessions` : undefined,
      color: "text-[#6B9E7A]",
    },
  ];
}

interface Props {
  /** If provided, use live data from parent instead of fetching */
  data?: Partial<IntelligenceData>;
}

export default function VoiceIntelligence({ data: propData }: Props = {}) {
  const [liveData, setLiveData] = useState<IntelligenceData>(defaultData);
  const [loading, setLoading] = useState(!propData);

  useEffect(() => {
    if (propData) return; // Parent provides data
    let cancelled = false;
    (async () => {
      try {
        if (isTauri()) {
          const { invoke } = await import("@tauri-apps/api/core");
          const result = await invoke<Partial<IntelligenceData>>("get_voice_intelligence");
          if (!cancelled && result) {
            setLiveData({ ...defaultData(), ...result });
          }
        } else {
          const port = localStorage.getItem("stt-ws-port") || "8765";
          const resp = await fetch(`http://127.0.0.1:${port}/api/insights/voice-intelligence`);
          if (resp.ok) {
            const result = await resp.json();
            if (!cancelled) setLiveData({ ...defaultData(), ...result });
          }
        }
      } catch (e) {
        console.warn("[VoiceIntelligence] Failed to load:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propData]);

  const effectiveData = propData ? { ...defaultData(), ...propData } : liveData;
  const insights = buildInsights(effectiveData);

  return (
    <div className="rounded-[14px] bg-white border border-border px-5 py-5">
      <div className="mb-5">
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">Voice Intelligence</h3>
        <p className="text-[12px] text-text-muted">Insights from your voice patterns</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {insights.map((item) => (
          <div key={item.label} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <item.icon size={14} className={item.color} />
              <span className="text-[11px] text-text-muted uppercase tracking-wide">{item.label}</span>
            </div>
            <div className="text-[16px] font-semibold text-text-primary leading-tight">
              {loading ? <span className="inline-block w-12 h-4 bg-border rounded animate-pulse" /> : item.value}
            </div>
            {item.detail && (
              <span className="text-[11px] text-text-muted">{item.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
