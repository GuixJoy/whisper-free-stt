import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/Sidebar";
import { HeroBanner } from "@/components/HeroBanner";
import { InsightPanel } from "@/components/InsightPanel";
import { ActivityTable } from "@/components/ActivityTable";
import { Bell, Minus, Square, X } from "lucide-react";

interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {}

const activityItems = [
  { time: "02:39 PM", event: "The transcription was dismissed.", hasInfo: true },
  { time: "02:32 PM", event: "Audio is silent.", hasInfo: true },
  { time: "02:32 PM", event: "Audio is silent.", hasInfo: true },
  { time: "02:31 PM", event: "You" },
  { time: "02:31 PM", event: "you" },
  { time: "02:31 PM", event: "you" },
  { time: "02:30 PM", event: "Audio is silent.", hasInfo: true },
];

export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  ({ className, ...props }, ref) => {
    const [activeItem, setActiveItem] = useState("Home");

    return (
      <div
        ref={ref}
        className={cn(
          "flex h-screen bg-app-bg overflow-hidden relative",
          className,
        )}
        {...props}
      >
        {/* Ambient glow layer */}
        <div className="ambient-glow" />

        {/* Sidebar */}
        <Sidebar activeItem={activeItem} onNavigate={setActiveItem} />

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {/* Title Bar */}
          <div className="flex items-center justify-between h-12 px-4 bg-transparent border-b border-white/[0.05]">
            <div className="flex items-center gap-2">
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-secondary">
                  <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-secondary">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="8" cy="6" r="2" fill="currentColor" />
                  <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors">
                <Bell size={16} className="text-text-secondary" />
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors">
                <Minus size={16} className="text-text-secondary" />
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors">
                <Square size={14} className="text-text-secondary" />
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/[0.04] transition-colors">
                <X size={16} className="text-text-secondary" />
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto">
            <div className="flex h-full">
              {/* Main Content */}
              <div className="flex-1 p-10 max-w-[1400px]">
                <h1 className="text-page-title text-text-primary mb-6">
                  Welcome back, Joy
                </h1>

                <HeroBanner className="mb-8" />

                <div className="mt-8">
                  <ActivityTable
                    date="MAY 23, 2026"
                    items={activityItems}
                  />
                </div>
              </div>

              {/* Insight Panel */}
              <div className="p-10 pl-0">
                <InsightPanel />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

AppShell.displayName = "AppShell";
