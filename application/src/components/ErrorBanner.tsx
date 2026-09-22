import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AppError {
  id: string;
  category: "connection" | "model" | "mic" | "permission" | "general";
  message: string;
  canRetry: boolean;
  retryHint?: string;
  dismissed: boolean;
}

interface Props {
  errors: AppError[];
  onDismiss: (id: string) => void;
  onRetry: (id: string) => void;
  visible: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  connection: "conn",
  model: "model",
  mic: "mic",
  permission: "perm",
  general: "error",
};

export default function ErrorSidePanel({ errors, onDismiss, onRetry, visible, onClose }: Props) {
  const activeErrors = errors.filter((e) => !e.dismissed);

  return (
    <aside
      className={cn(
        "fixed right-4 top-4 z-50 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-card border border-border transition duration-300",
        visible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-full opacity-0",
        "bg-app-surface shadow-lg",
      )}
      role="complementary"
      aria-label="Error log"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-balance text-subheading text-text-primary">
          Errors ({activeErrors.length})
        </h2>
        <button
          className={cn(
            "inline-flex h-8 items-center justify-center rounded-button px-3 text-small font-medium transition-colors duration-200",
            "border border-border bg-app-surface text-text-primary hover:bg-app-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={onClose}
          aria-label="Hide error panel"
        >
          <X size={14} /> Hide
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
        {activeErrors.length === 0 ? (
          <p className="py-8 text-center text-body text-text-muted">
            No active errors. System running normally.
          </p>
        ) : (
          activeErrors.map((err) => (
            <div
              key={err.id}
              className="animate-panel-in overflow-hidden rounded-card border border-border bg-app-surface-secondary"
              role="alert"
            >
              <div className="flex items-start gap-3 px-3 py-2.5">
                <span
                  className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent")}
                  aria-hidden="true"
                />
                <span
                  className="rounded border border-border bg-app-surface px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted"
                  aria-hidden="true"
                >
                  {CATEGORY_LABELS[err.category] || "error"}
                </span>
                <span className="flex-1 text-body text-text-primary">{err.message}</span>
                <button
                  className="flex shrink-0 items-center text-text-muted transition-colors hover:text-text-primary"
                  onClick={() => onDismiss(err.id)}
                  aria-label={`Dismiss error: ${err.message}`}
                >
                  <X size={15} />
                </button>
              </div>
              {err.retryHint && (
                <p className="px-3 pb-2 pl-8 text-small text-text-muted">Hint: {err.retryHint}</p>
              )}
              {err.canRetry && (
                <div className="px-3 pb-2.5 pl-8">
                  <button
                    className={cn(
                      "inline-flex h-8 items-center justify-center rounded-button px-3 text-small font-medium transition-colors duration-200",
                      "border border-border bg-app-surface text-text-primary hover:bg-app-hover",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
                    )}
                    onClick={() => onRetry(err.id)}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
