import { MessageSquare, BarChart3, Timer } from "lucide-react";

const patterns = [
  { icon: MessageSquare, label: "Avg Utterance Length", value: "12.4 words", color: "text-accent" },
  { icon: BarChart3, label: "Session Frequency", value: "5.4 / day", color: "text-accent" },
  { icon: Timer, label: "Avg Session Duration", value: "4m 32s", color: "text-accent" },
];

const weeklyData = [
  { day: "Mon", words: 2400 },
  { day: "Tue", words: 3200 },
  { day: "Wed", words: 1800 },
  { day: "Thu", words: 4100 },
  { day: "Fri", words: 3600 },
  { day: "Sat", words: 1200 },
  { day: "Sun", words: 800 },
];

const maxWords = Math.max(...weeklyData.map((d) => d.words));

export default function SpeakingPatternsCard() {
  return (
    <div className="rounded-[14px] bg-white border border-border px-5 py-4 min-h-[180px]">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-app-surface-secondary">
          <BarChart3 size={14} className="text-accent" />
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">Speaking Patterns</span>
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">How you use your voice</span>
        </div>
      </div>

      {/* Quick Metrics */}
      <div className="flex flex-col gap-2.5 mb-4">
        {patterns.map((p) => (
          <div key={p.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p.icon size={13} className={p.color} />
              <span className="text-[12px] text-text-secondary">{p.label}</span>
            </div>
            <span className="text-[12px] font-medium text-text-primary">{p.value}</span>
          </div>
        ))}
      </div>

      {/* Weekly Bar Chart */}
      <div>
        <span className="text-[11px] text-text-muted uppercase tracking-wide font-medium mb-2 block">This Week</span>
        <div className="flex items-end gap-1.5 h-[60px]">
          {weeklyData.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full rounded-[3px] bg-accent/20 transition-all duration-300 hover:bg-accent/40"
                style={{ height: `${(d.words / maxWords) * 100}%` }}
              />
              <span className="text-[9px] text-text-muted">{d.day}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
