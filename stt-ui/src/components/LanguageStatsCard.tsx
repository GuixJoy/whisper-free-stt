import { Globe, Languages, Star } from "lucide-react";

const languages = [
  { name: "English", pct: 82, flag: "🇺🇸" },
  { name: "Hindi", pct: 12, flag: "🇮🇳" },
  { name: "Spanish", pct: 6, flag: "🇪🇸" },
];

const qualities = [
  { label: "Primary", value: "English", icon: Star },
  { label: "Secondary", value: "Hindi", icon: Languages },
  { label: "Accuracy", value: "94.2%", icon: Globe },
];

export default function LanguageStatsCard() {
  return (
    <div className="rounded-[14px] bg-white border border-border px-5 py-4 min-h-[180px]">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="flex items-center justify-center w-[26px] h-[26px] rounded-[7px] bg-app-surface-secondary">
          <Globe size={14} className="text-accent" />
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">Language Statistics</span>
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">Your multilingual usage</span>
        </div>
      </div>

      {/* Language Breakdown */}
      <div className="flex flex-col gap-2.5 mb-4">
        {languages.map((lang) => (
          <div key={lang.name} className="flex items-center gap-2.5">
            <span className="text-[14px]">{lang.flag}</span>
            <span className="text-[12px] text-text-secondary w-[60px]">{lang.name}</span>
            <div className="flex-1 h-[6px] rounded-full bg-border-hover overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${lang.pct}%` }}
              />
            </div>
            <span className="text-[11px] text-text-muted w-[30px] text-right">{lang.pct}%</span>
          </div>
        ))}
      </div>

      {/* Quick Stats */}
      <div className="flex flex-col gap-2">
        {qualities.map((q) => (
          <div key={q.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <q.icon size={12} className="text-accent" />
              <span className="text-[12px] text-text-secondary">{q.label}</span>
            </div>
            <span className="text-[12px] font-medium text-text-primary">{q.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
