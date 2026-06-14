// ── Persistent error sidebar log panel ──
import { motion, AnimatePresence } from "framer-motion";

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

export default function ErrorSidePanel({ errors, onDismiss, onRetry, visible, onClose }: Props) {
  const activeErrors = errors.filter((e) => !e.dismissed);

  return (
    <aside
      className={`error-side-panel ${visible ? "expanded" : "collapsed"}`}
      role="complementary"
      aria-label="Error log"
    >
      <div className="error-panel-header">
        <h2>⚠️ Errors ({activeErrors.length})</h2>
        <button
          className="sketch-btn btn-sm"
          onClick={onClose}
          aria-label="Hide error panel"
        >
          ✕ Hide
        </button>
      </div>
      <div className="error-panel-body">
        {activeErrors.length === 0 ? (
          <p className="error-panel-empty">No active errors. System running normally.</p>
        ) : (
          <AnimatePresence>
            {activeErrors.map((err) => (
              <motion.div
                key={err.id}
                className={`error-item error-${err.category}`}
                initial={{ height: 0, opacity: 0, scale: 0.95 }}
                animate={{ height: "auto", opacity: 1, scale: 1 }}
                exit={{ height: 0, opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                role="alert"
              >
                <div className="error-item-header">
                  <span className="error-item-icon" aria-hidden="true">
                    {CATEGORY_ICONS[err.category] || "⚠️"}
                  </span>
                  <span className="error-item-message">
                    {err.message}
                  </span>
                  <button
                    className="error-item-dismiss"
                    onClick={() => onDismiss(err.id)}
                    aria-label={`Dismiss error: ${err.message}`}
                  >
                    ×
                  </button>
                </div>
                {err.retryHint && (
                  <p className="error-item-hint">
                    Hint: {err.retryHint}
                  </p>
                )}
                {err.canRetry && (
                  <div className="error-item-actions">
                    <button
                      className="sketch-btn btn-sm"
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
