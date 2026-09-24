import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  Home,
  BarChart3,
  BookOpen,
  Clock,
  SlidersHorizontal,
  Settings,
  Cpu,
} from "lucide-react";

interface SidebarItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  onClick?: () => void;
}

function SidebarItem({ icon, label, active, badge, onClick }: SidebarItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex h-10 w-full items-center gap-3 overflow-hidden rounded-badge px-3 text-left transition-colors duration-200",
        active ? "font-semibold text-accent" : "text-text-secondary hover:bg-accent-hover-surface",
      )}
    >
      {active && (
        <>
          <div className="absolute inset-0 bg-accent-surface" />
          <div className="absolute bottom-0 left-0 top-0 w-[3px] rounded-r bg-accent" />
        </>
      )}
      <span className="relative z-10 h-[18px] w-[18px] flex-shrink-0">{icon}</span>
      <span className="relative z-10 flex-1 text-[15px]">{label}</span>
      {badge && (
        <span className="relative z-10 rounded-[8px] bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  activeItem?: string;
  onNavigate?: (item: string) => void;
}

export const Sidebar = forwardRef<HTMLDivElement, SidebarProps>(
  ({ className, activeItem = "Home", onNavigate, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex h-full w-sidebar-width flex-col p-4", className)}
        style={{
          backgroundColor: "rgba(255,255,255,0.40)",
          borderRight: "1px solid rgba(44,37,32,0.06)",
        }}
        {...props}
      >
        {/* Logo */}
        <div className="mb-6 flex items-center gap-2">
          <div className="flex items-center gap-2">
            <img
              src="/logo.png"
              alt="Floure"
              width={24}
              height={24}
              className="h-6 w-6 object-contain"
            />
            <h1
              translate="no"
              className="text-[20px] font-bold text-text-primary"
              style={{ fontFamily: "'Instrument Serif', serif" }}
            >
              Floure
            </h1>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex flex-1 flex-col gap-1">
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
        </div>

        {/* Upgrade Card */}
        <div className="relative mb-4 overflow-hidden rounded-card border border-border bg-app-surface-dark p-4">
          <div className="relative z-10 flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Floure"
              width={32}
              height={32}
              className="h-8 w-8 object-contain"
            />
            <div>
              <p className="text-[15px] font-semibold text-text-primary">Floure</p>
              <p className="text-[12px] text-text-secondary">Local-first STT</p>
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-col gap-1">
          <div className="mb-2 h-px bg-border" />
          <SidebarItem
            icon={<Settings size={18} />}
            label="Settings"
            active={activeItem === "Settings"}
            onClick={() => onNavigate?.("Settings")}
          />
        </div>
      </div>
    );
  },
);

Sidebar.displayName = "Sidebar";
