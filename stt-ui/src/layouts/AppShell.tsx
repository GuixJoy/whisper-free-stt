import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "@/components/Sidebar";
import { Bell, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  activeItem: string;
  onNavigate: (item: string) => void;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  ({ className, children, activeItem, onNavigate, ...props }, ref) => {
    const win = isTauri() ? getCurrentWindow() : null;

    return (
      <div
        ref={ref}
        className={cn(
          "flex h-screen overflow-hidden relative",
          className,
        )}
        style={{ backgroundColor: "#FAF8F5", color: "#2C2520" }}
        {...props}
      >
        {/* Ambient glow layer */}
        <div className="ambient-glow" />

        {/* Sidebar */}
        <Sidebar activeItem={activeItem} onNavigate={onNavigate} />

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {/* Title Bar */}
          <div
            className="flex items-center justify-between h-12 px-4 bg-transparent border-b border-border"
            data-tauri-drag-region
          >
            <div className="flex items-center gap-2" data-tauri-drag-region="false">
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-secondary">
                  <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-text-secondary">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="8" cy="6" r="2" fill="currentColor" />
                  <path d="M4 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>

            <div className="flex items-center gap-1" data-tauri-drag-region="false">
              <button className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors">
                <Bell size={16} className="text-text-secondary" />
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors"
                onClick={() => win?.minimize()}
              >
                <Minus size={16} className="text-text-secondary" />
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors"
                onClick={() => win?.toggleMaximize()}
              >
                <Square size={14} className="text-text-secondary" />
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors"
                onClick={() => win?.hide()}
              >
                <X size={16} className="text-text-secondary" />
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </div>
      </div>
    );
  },
);

AppShell.displayName = "AppShell";
