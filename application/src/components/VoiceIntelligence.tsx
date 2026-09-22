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
      detail:
        data.mostActiveDayWords > 0
          ? `Average ${data.mostActiveDayWords.toLocaleString()} words`
          : undefined,
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

export default function VoiceIntelligence() {
  const [liveData, setLiveData] = useState<IntelligenceData>(defaultData);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<Partial<IntelligenceData>>("get_voice_intelligence");
        if (!cancelled && result) {
          setLiveData({ ...defaultData(), ...result });
        }
      } catch (e) {
        console.warn("[VoiceIntelligence] Failed to load:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const insights = buildInsights(liveData);

  return (
    <div className="rounded-[14px] border border-border bg-white px-5 py-5">
      <div className="mb-5">
        <h3 className="mb-1 text-[15px] font-semibold text-text-primary">Voice Intelligence</h3>
        <p className="text-[12px] text-text-muted">Insights from your voice patterns</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {insights.map((item) => (
          <div key={item.label} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <item.icon size={14} className={item.color} />
              <span className="text-[11px] uppercase tracking-wide text-text-muted">
                {item.label}
              </span>
            </div>
            <div className="text-[16px] font-semibold leading-tight text-text-primary">
              {loading ? (
                <span className="inline-block h-4 w-12 animate-pulse rounded bg-border" />
              ) : (
                item.value
              )}
            </div>
            {item.detail && <span className="text-[11px] text-text-muted">{item.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
