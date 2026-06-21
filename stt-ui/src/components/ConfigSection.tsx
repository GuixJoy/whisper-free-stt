import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface ConfigSectionProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}

export function ConfigSection({ icon: Icon, title, subtitle, children, className }: ConfigSectionProps) {
  return (
    <div
      className={cn(
        "rounded-[16px] bg-white border border-border",
        "px-5 py-4",
        className,
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center w-[28px] h-[28px] rounded-[8px] bg-app-surface-secondary">
          <Icon size={15} className="text-text-secondary" />
        </div>
        <div className="flex flex-col">
          <span className="text-[14px] font-semibold text-text-primary leading-tight">{title}</span>
          {subtitle && <span className="text-[11px] text-text-muted leading-tight mt-0.5">{subtitle}</span>}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
}
