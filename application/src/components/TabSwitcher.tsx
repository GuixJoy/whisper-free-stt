import { useRef } from "react";
import { cn } from "@/lib/utils";

interface Tab {
  id: string;
  label: string;
}

interface TabSwitcherProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
}

export default function TabSwitcher({ tabs, activeTab, onChange }: TabSwitcherProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === activeTab);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.id);
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <div ref={ref} role="tablist" aria-label="Sections" onKeyDown={onKeyDown} className="flex items-center gap-1 border-b border-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          data-tab={tab.id}
          aria-selected={activeTab === tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative px-4 py-2.5 text-[13px] font-medium transition-colors rounded-t-lg",
            activeTab === tab.id
              ? "text-accent bg-accent-surface"
              : "text-text-muted hover:text-text-secondary hover:bg-accent-hover-surface",
          )}
        >
          {tab.label}
          {activeTab === tab.id && (
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent rounded-t" />
          )}
        </button>
      ))}
    </div>
  );
}
