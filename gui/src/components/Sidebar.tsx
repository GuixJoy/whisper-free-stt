import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  Home,
  BarChart3,
  BookOpen,
  Scissors,
  Type,
  Shuffle,
  FileText,
  Users,
  Gift,
  Settings,
  HelpCircle,
} from "lucide-react";
import { Badge } from "./Badge";
import { Divider } from "./Divider";

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
          ? "text-white font-semibold"
          : "text-text-secondary hover:bg-white/[0.04]",
      )}
    >
      {active && (
        <>
          <div className="absolute inset-0 bg-gradient-to-r from-accent/20 via-accent/8 to-transparent" />
          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-accent via-accent-warm to-accent/40 rounded-r" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(200,138,50,0.12),transparent_70%)] pointer-events-none" />
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
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col h-full bg-app-sidebar border-r border-white/[0.03] p-4 w-sidebar-width",
          className,
        )}
        {...props}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div className="flex items-center gap-1.5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-text-primary">
              <rect x="2" y="4" width="4" height="16" rx="1" fill="currentColor" opacity="0.3" />
              <rect x="8" y="2" width="4" height="20" rx="1" fill="currentColor" opacity="0.5" />
              <rect x="14" y="6" width="4" height="12" rx="1" fill="currentColor" opacity="0.7" />
              <rect x="20" y="4" width="4" height="16" rx="1" fill="currentColor" />
            </svg>
            <span className="text-[20px] font-bold text-text-primary">Flow</span>
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
            icon={<Scissors size={18} />}
            label="Snippets"
            active={activeItem === "Snippets"}
            onClick={() => onNavigate?.("Snippets")}
          />
          <SidebarItem
            icon={<Type size={18} />}
            label="Style"
            active={activeItem === "Style"}
            onClick={() => onNavigate?.("Style")}
          />
          <SidebarItem
            icon={<Shuffle size={18} />}
            label="Transforms"
            active={activeItem === "Transforms"}
            onClick={() => onNavigate?.("Transforms")}
          />
          <SidebarItem
            icon={<FileText size={18} />}
            label="Scratchpad"
            active={activeItem === "Scratchpad"}
            onClick={() => onNavigate?.("Scratchpad")}
          />
        </SidebarSection>

        {/* Upgrade Card */}
        <div className="relative rounded-card p-4 mb-4 overflow-hidden border border-accent/20">
          <div className="absolute inset-0 bg-app-surface-card" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(200,138,50,0.10),transparent_70%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_80%,rgba(50,120,130,0.08),transparent_60%)]" />
          <div className="relative z-10">
            <p className="text-[15px] font-semibold text-accent-bright mb-1">2,000 words remaining</p>
            <p className="text-[13px] text-text-secondary mb-3 leading-[20px]">
              You get 2,000 words per week. Upgrade for unlimited access.
            </p>
            <button className="w-full h-10 bg-accent text-white rounded-button text-[14px] font-medium hover:bg-accent-warm transition-colors shadow-accent-button">
              Upgrade to Pro
            </button>
          </div>
        </div>

        {/* Bottom Actions */}
        <SidebarSection>
          <Divider className="mb-2" />
          <SidebarItem
            icon={<Users size={18} />}
            label="Invite your team"
            onClick={() => onNavigate?.("Invite")}
          />
          <SidebarItem
            icon={<Gift size={18} />}
            label="Get a free month"
            onClick={() => onNavigate?.("FreeMonth")}
          />
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
