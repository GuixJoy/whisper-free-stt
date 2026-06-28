import { forwardRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Home,
  BarChart3,
  BookOpen,
  Clock,
  SlidersHorizontal,
  Settings,
  HelpCircle,
  CircleDot,
  Cpu,
} from "lucide-react";
import { Badge } from "./Badge";
import { Divider } from "./Divider";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}

export function SidebarItem({ icon, label, active, badge, onClick }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3 w-full h-10 px-3 rounded-badge text-left transition-all duration-200 overflow-hidden",
        active
          ? "text-accent font-semibold"
          : "text-text-secondary hover:bg-accent-hover-surface",
      )}
    >
      {active && (
        <>
          <div className="absolute inset-0 bg-accent-surface" />
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent rounded-r" />
        </>
      )}
      <span className="relative z-10 w-[18px] h-[18px] flex-shrink-0">{icon}</span>
      <span className="relative z-10 text-[15px] flex-1">{label}</span>
      {badge && (
        <span className="relative z-10 bg-accent text-white text-[11px] font-semibold px-2 py-0.5 rounded-[8px]">
          {badge}
        </span>
      )}
    </button>
  );
}

interface SidebarSectionProps {
  children: React.ReactNode;
  className?: string;
}

export function SidebarSection({ children, className }: SidebarSectionProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {children}
    </div>
  );
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  activeItem?: string;
  onNavigate?: (item: string) => void;
}

export const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, activeItem = "Home", onNavigate, ...props }, ref) => {
    const [widgetVisible, setWidgetVisible] = useState(false);

    const toggleWidget = useCallback(async () => {
      if (!isTauri()) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const visible = await invoke<boolean>("toggle_widget");
        setWidgetVisible(visible);
      } catch (err) {
        console.error("[Widget] toggle failed:", err);
      }
    }, []);

    useEffect(() => {
      if (!isTauri()) return;
      let unlisten: (() => void) | undefined;
      (async () => {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          unlisten = await listen<boolean>("widget-visibility-changed", (event) => {
            setWidgetVisible(event.payload);
          });
        } catch { /* not in Tauri */ }
      })();
      return () => { unlisten?.(); };
    }, []);
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col h-full p-4 w-sidebar-width",
          className,
        )}
        style={{ backgroundColor: "rgba(255,255,255,0.40)", borderRight: "1px solid rgba(44,37,32,0.06)" }}
        {...props}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="Floure" className="w-6 h-6 object-contain" />
            <span className="text-[20px] font-bold text-text-primary" style={{ fontFamily: "'Instrument Serif', serif" }}>Floure</span>
          </div>
          <Badge variant="plan">Basic</Badge>
        </div>

        {/* Navigation */}
        <SidebarSection className="flex-1">
          <SidebarItem
            icon={<Home size={18} />}
            label="Home"
            active={activeItem === "Home"}
            onClick={() => onNavigate?.("Home")}
          />
          <SidebarItem
            icon={<BarChart3 size={18} />}
            label="Insights"
            badge="New!"
            active={activeItem === "Insights"}
            onClick={() => onNavigate?.("Insights")}
          />
          <SidebarItem
            icon={<BookOpen size={18} />}
            label="Dictionary"
            active={activeItem === "Dictionary"}
            onClick={() => onNavigate?.("Dictionary")}
          />
          <SidebarItem
            icon={<Clock size={18} />}
            label="History"
            active={activeItem === "History"}
            onClick={() => onNavigate?.("History")}
          />
          <SidebarItem
            icon={<SlidersHorizontal size={18} />}
            label="Config"
            active={activeItem === "Config"}
            onClick={() => onNavigate?.("Config")}
          />
          <SidebarItem
            icon={<Cpu size={18} />}
            label="Models"
            active={activeItem === "Models"}
            onClick={() => onNavigate?.("Models")}
          />

          {/* Widget Toggle — feature control, not navigation */}
          <button
            onClick={toggleWidget}
            className={cn(
              "relative flex items-center gap-3 w-full h-10 px-3 rounded-badge text-left transition-all duration-200",
              "text-text-secondary hover:bg-accent-hover-surface",
            )}
          >
            <span className="relative z-10 w-[18px] h-[18px] flex-shrink-0">
              <CircleDot size={18} />
            </span>
            <span className="relative z-10 text-[15px] flex-1 flex items-center gap-2">
              Widget
              {widgetVisible && (
                <span className="w-[6px] h-[6px] rounded-full bg-green-500 flex-shrink-0" />
              )}
            </span>
            {/* Toggle switch */}
            <span
              className={cn(
                "relative z-10 w-[36px] h-[20px] rounded-full transition-colors duration-200 flex-shrink-0",
                widgetVisible ? "bg-accent" : "bg-[#D8D8D8]",
              )}
            >
              <span
                className={cn(
                  "absolute top-[2px] w-[16px] h-[16px] rounded-full bg-white transition-transform duration-200",
                  widgetVisible ? "translate-x-[18px]" : "translate-x-[2px]",
                )}
              />
            </span>
          </button>
        </SidebarSection>

        {/* Upgrade Card */}
        <div className="relative rounded-card p-4 mb-4 overflow-hidden border border-border bg-app-surface-dark">
          <div className="relative z-10 flex items-center gap-3">
            <img src="/logo.png" alt="Floure" className="w-8 h-8 object-contain" />
            <div>
              <p className="text-[15px] font-semibold text-text-primary">Floure</p>
              <p className="text-[12px] text-text-secondary">Local-first STT</p>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <SidebarSection>
          <Divider className="mb-2" />
          <SidebarItem
            icon={<Settings size={18} />}
            label="Settings"
            active={activeItem === "Settings"}
            onClick={() => onNavigate?.("Settings")}
          />
          <SidebarItem
            icon={<HelpCircle size={18} />}
            label="Help"
            onClick={() => onNavigate?.("Help")}
          />
        </SidebarSection>
      </div>
    );
  },
);

Sidebar.displayName = "Sidebar";
