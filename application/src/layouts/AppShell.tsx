import { forwardRef, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { cn, isTauri } from "@/lib/utils";
import { Sidebar } from "@/components/Sidebar";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  activeItem: string;
  onNavigate: (item: string) => void;
}

export const AppShell = forwardRef<HTMLDivElement, AppShellProps>(
  ({ className, children, activeItem, onNavigate, ...props }, ref) => {
    const win = isTauri() ? getCurrentWindow() : null;

    const onTitleBarMouseDown = useCallback(
      (e: ReactMouseEvent<HTMLDivElement>) => {
        if (!win) return;
        if (e.button !== 0) return;
        // Don't drag if click was on a button or interactive element
        const target = e.target as HTMLElement;
        if (target.closest("button") || target.closest("a") || target.closest("input")) return;
        e.preventDefault();
        // One handler for both gestures: the second click of a double-click
        // reports detail === 2, so maximize instead of starting another drag.
        // Splitting these across onMouseDown/onDoubleClick raced the drag.
        if (e.detail === 2) {
          win.toggleMaximize();
        } else {
          win.startDragging();
        }
      },
      [win],
    );

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
            className="flex items-center justify-between h-12 px-4 bg-transparent border-b border-border select-none"
            onMouseDown={onTitleBarMouseDown}
          >
            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors"
                onClick={() => win?.minimize()}
                aria-label="Minimize window"
              >
                <Minus size={16} className="text-text-secondary" />
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors"
                onClick={() => win?.toggleMaximize()}
                aria-label="Maximize or restore window"
              >
                <Square size={14} className="text-text-secondary" />
              </button>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-border transition-colors"
                onClick={() => win?.hide()}
                aria-label="Hide window"
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
