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
  return (
    <div className="flex items-center gap-1 border-b border-white/[0.06]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "relative px-4 py-2.5 text-[14px] font-medium transition-colors",
            activeTab === tab.id
              ? "text-white"
              : "text-[#7A7F87] hover:text-[#A8A096]",
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
