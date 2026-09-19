import { cn } from "@/lib/utils";

interface FloureToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  className?: string;
}

export function FloureToggle({ checked, onChange, label, description, className }: FloureToggleProps) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      {(label || description) && (
        <div className="flex flex-col min-w-0">
          {label && <span className="text-[12px] font-medium text-text-primary leading-tight">{label}</span>}
          {description && <span className="text-[11px] text-text-muted leading-tight mt-0.5">{description}</span>}
        </div>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-[20px] w-[36px] flex-shrink-0 rounded-full transition-colors duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          checked ? "bg-accent" : "bg-[#D8D3CC]",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-[18px]" : "translate-x-[2px]",
          )}
          style={{ marginTop: "2px" }}
        />
      </button>
    </div>
  );
}
