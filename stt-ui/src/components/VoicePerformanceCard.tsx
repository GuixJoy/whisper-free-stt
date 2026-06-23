import { Clock, Zap, Globe, Mic } from "lucide-react";

interface VoicePerformanceCardProps {
  wpm: number;
}

const metrics = [
  { icon: Clock, label: "Avg Session", value: "4m 32s", color: "text-accent" },
  { icon: Zap, label: "Fast Commit", value: "78%", color: "text-accent" },
  { icon: Globe, label: "Language", value: "English", color: "text-accent" },
  { icon: Mic, label: "Peak Hour", value: "10 AM", color: "text-accent" },
];

export default function VoicePerformanceCard(_props: VoicePerformanceCardProps) {
  return (
    <div className="rounded-[14px] bg-white border border-border px-5 py-4 min-h-[180px]">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-app-surface-secondary">
          <span className="text-[13px]">⚡</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">Voice Performance</span>
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">Quick metrics overview</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-2.5 p-2.5 rounded-[8px] bg-app-surface-secondary">
            <m.icon size={14} className={m.color} />
            <div className="flex flex-col">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">{m.label}</span>
              <span className="text-[13px] font-medium text-text-primary">{m.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
