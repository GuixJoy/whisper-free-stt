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
    <aside className={`error-side-panel ${visible ? "expanded" : "collapsed"}`}>
      <div className="error-panel-header">
        <h2>⚠️ Errors ({activeErrors.length})</h2>
        <button className="sketch-btn btn-sm" onClick={onClose}>
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
                className={`error-banner error-${err.category}`}
                initial={{ height: 0, opacity: 0, scale: 0.95 }}
                animate={{ height: "auto", opacity: 1, scale: 1 }}
                exit={{ height: 0, opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  padding: "0.75rem",
                  marginBottom: "0.5rem",
                  border: "2px solid",
                  borderRadius: "8px",
                  boxShadow: "var(--sketch-shadow)",
                  overflow: "hidden"
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", width: "100%", gap: "0.5rem" }}>
                  <span className="error-icon" style={{ fontSize: "1.1rem", flexShrink: 0 }}>
                    {CATEGORY_ICONS[err.category] || "⚠️"}
                  </span>
                  <span className="error-message" style={{ fontWeight: 600, fontSize: "0.85rem", wordBreak: "break-word", flex: 1 }}>
                    {err.message}
                  </span>
                  <button className="error-dismiss" onClick={() => onDismiss(err.id)} style={{ marginLeft: "auto", cursor: "pointer", background: "none", border: "none", fontSize: "1.2rem" }}>
                    ×
                  </button>
                </div>
                {err.retryHint && (
                  <p style={{ fontSize: "0.78rem", fontStyle: "italic", opacity: 0.85, fontFamily: "var(--font-hand)", color: "var(--ink-mid)" }}>
                    Hint: {err.retryHint}
                  </p>
                )}
                {err.canRetry && (
                  <button
                    className="sketch-btn btn-sm"
                    onClick={() => onRetry(err.id)}
                    style={{ alignSelf: "flex-start", marginTop: "0.2rem" }}
                  >
                    Retry
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </aside>
  );
}
