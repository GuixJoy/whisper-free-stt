import { motion, AnimatePresence } from "framer-motion";
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

const CATEGORY_ICONS: Record<string, string> = {
  connection: "🔌",
  model: "🧠",
  mic: "🎤",
  permission: "🔒",
  general: "⚠️",
};

const CATEGORY_DOT: Record<string, string> = {
  connection: "bg-blue-500",
  model: "bg-purple-500",
  mic: "bg-accent",
  permission: "bg-yellow-500",
  general: "bg-red-500",
};

export default function ErrorSidePanel({ errors, onDismiss, onRetry, visible, onClose }: Props) {
  const activeErrors = errors.filter((e) => !e.dismissed);

  return (
    <aside
      className={cn(
        "fixed top-4 right-4 z-50 flex flex-col w-80 max-h-[70vh] rounded-card border border-border overflow-hidden transition-all duration-300",
        visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-full pointer-events-none",
        "bg-app-surface shadow-lg",
      )}
      role="complementary"
      aria-label="Error log"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-subheading text-text-primary">⚠️ Errors ({activeErrors.length})</h2>
        <button
          className={cn(
            "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
            "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={onClose}
          aria-label="Hide error panel"
        >
          ✕ Hide
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {activeErrors.length === 0 ? (
          <p className="text-center text-text-muted text-body py-8">No active errors. System running normally.</p>
        ) : (
          <AnimatePresence>
            {activeErrors.map((err) => (
              <motion.div
                key={err.id}
                className="bg-app-surface-secondary rounded-card border border-border overflow-hidden"
                initial={{ height: 0, opacity: 0, scale: 0.95 }}
                animate={{ height: "auto", opacity: 1, scale: 1 }}
                exit={{ height: 0, opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                role="alert"
              >
                <div className="flex items-start gap-3 px-3 py-2.5">
                  <span className={cn("mt-0.5 h-2 w-2 rounded-full shrink-0", CATEGORY_DOT[err.category] || "bg-red-500")} aria-hidden="true" />
                  <span className="text-text-primary" aria-hidden="true">
                    {CATEGORY_ICONS[err.category] || "⚠️"}
                  </span>
                  <span className="flex-1 text-body text-text-primary">
                    {err.message}
                  </span>
                  <button
                    className="text-text-muted hover:text-text-primary text-lg leading-none shrink-0 transition-colors"
                    onClick={() => onDismiss(err.id)}
                    aria-label={`Dismiss error: ${err.message}`}
                  >
                    ×
                  </button>
                </div>
                {err.retryHint && (
                  <p className="px-3 pb-2 pl-8 text-small text-text-muted">
                    Hint: {err.retryHint}
                  </p>
                )}
                {err.canRetry && (
                  <div className="px-3 pb-2.5 pl-8">
                    <button
                      className={cn(
                        "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
                        "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
                      )}
                      onClick={() => onRetry(err.id)}
                    >
                      Retry
                    </button>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </aside>
  );
}
