// ── Persistent error banner with retry ──
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
}

const CATEGORY_ICONS: Record<string, string> = {
  connection: "🔌",
  model: "🧠",
  mic: "🎤",
  permission: "🔒",
  general: "⚠️",
};

export default function ErrorBanner({ errors, onDismiss, onRetry }: Props) {
  const visible = errors.filter((e) => !e.dismissed);

  return (
    <div className="error-banner-container">
      <AnimatePresence>
        {visible.map((err) => (
          <motion.div
            key={err.id}
            className={`error-banner error-${err.category}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <span className="error-icon">{CATEGORY_ICONS[err.category] || "⚠️"}</span>
            <span className="error-message">{err.message}</span>
            {err.canRetry && (
              <button className="sketch-btn btn-sm" onClick={() => onRetry(err.id)}>
                Retry
              </button>
            )}
            <button className="error-dismiss" onClick={() => onDismiss(err.id)}>
              ×
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
