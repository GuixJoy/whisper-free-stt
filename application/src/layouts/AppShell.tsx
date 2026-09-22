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
        className={cn("relative flex h-screen overflow-hidden", className)}
        style={{ backgroundColor: "#FAF8F5", color: "#2C2520" }}
        {...props}
      >
        {/* Skip link: invisible until focused, jumps past sidebar + titlebar */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-white focus:px-4 focus:py-2 focus:text-[13px] focus:font-medium focus:text-text-primary focus:shadow-lg"
        >
          Skip to content
        </a>

        {/* Ambient glow layer */}
        <div className="ambient-glow" />

        {/* Sidebar */}
        <Sidebar activeItem={activeItem} onNavigate={onNavigate} />

        {/* Main Content */}
        <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
          {/* Title Bar */}
          <div
            className="flex h-12 select-none items-center justify-between border-b border-border bg-transparent px-4"
            onMouseDown={onTitleBarMouseDown}
          >
            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-border"
                onClick={() => win?.minimize()}
                aria-label="Minimize window"
              >
                <Minus size={16} className="text-text-secondary" />
              </button>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-border"
                onClick={() => win?.toggleMaximize()}
                aria-label="Maximize or restore window"
              >
                <Square size={14} className="text-text-secondary" />
              </button>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-border"
                onClick={() => win?.hide()}
                aria-label="Hide window"
              >
                <X size={16} className="text-text-secondary" />
              </button>
            </div>
          </div>

          {/* Content Area */}
          <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    );
  },
);

AppShell.displayName = "AppShell";
