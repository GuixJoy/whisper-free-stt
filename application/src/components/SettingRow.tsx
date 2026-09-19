import { cn } from "@/lib/utils";

interface SettingRowProps {
  label: string;
  description?: string;
  /** Associates the label with the wrapped control. Pass the same id to the input/select. */
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export function SettingRow({ label, description, htmlFor, children, className }: SettingRowProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex flex-col min-w-0">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-text-primary leading-tight">{label}</label>
        {description && (
          <span className="text-[11px] text-text-muted leading-tight mt-0.5">{description}</span>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}
