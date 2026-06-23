import { Calendar, Clock, Timer, Globe } from "lucide-react";

interface InsightItem {
  icon: React.ElementType;
  label: string;
  value: string;
  detail?: string;
  color: string;
}

const insights: InsightItem[] = [
  { icon: Calendar, label: "Most Active Day", value: "Tuesday", detail: "Average 3,200 words", color: "text-[#3B6B9E]" },
  { icon: Clock, label: "Most Productive Hour", value: "11 AM", detail: "Peak voice usage", color: "text-[#A88CC8]" },
  { icon: Timer, label: "Avg Dictation Length", value: "28 seconds", detail: "Per utterance", color: "text-accent" },
  { icon: Globe, label: "Most Used Language", value: "English", detail: "82% of sessions", color: "text-[#6B9E7A]" },
];

export default function VoiceIntelligence() {
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
            <div className="text-[16px] font-semibold text-text-primary leading-tight">{item.value}</div>
            {item.detail && (
              <span className="text-[11px] text-text-muted">{item.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
