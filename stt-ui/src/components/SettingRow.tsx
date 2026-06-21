import { cn } from "@/lib/utils";

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingRow({ label, description, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="flex flex-col min-w-0">
        <span className="text-[13px] font-medium text-text-primary leading-tight">{label}</span>
        {description && (
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">{description}</span>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
