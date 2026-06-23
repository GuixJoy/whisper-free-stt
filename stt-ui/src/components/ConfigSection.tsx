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
        "rounded-[12px] bg-white border border-border break-inside-avoid",
        "px-4 py-3 mb-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <Icon size={13} className="text-text-muted" />
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-text-primary leading-tight">{title}</span>
          {subtitle && <span className="text-[10px] text-text-muted leading-tight mt-0.5">{subtitle}</span>}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {children}
      </div>
    </div>
  );
}
