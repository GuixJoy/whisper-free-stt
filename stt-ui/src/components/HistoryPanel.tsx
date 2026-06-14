import { useEffect, useState, useCallback } from "react";

interface HistoryRow {
  id: number;
  raw_text: string;
  processed_text: string;
  language: string;
  mode: string;
  model: string;
  duration_sec: number;
  favorite: number;
  created_at: string;
}

const isTauri = (): boolean =>
  typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

interface Props {
  visible: boolean;
  onClose: () => void;
}

const formatDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
};

export default function HistoryPanel({ visible, onClose }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!isTauri()) {
        setError("History only available in the desktop app (Tauri)");
        setLoading(false);
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<HistoryRow[]>("get_history", { limit: 100 });
      setRows(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setRows([]);
      return;
    }
    loadHistory();
  }, [visible, loadHistory]);

  // Keyboard handler: Escape to close
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  const copyText = async (text: string, id: number) => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* clipboard denied */ }
  };

  if (!visible) return null;

  return (
    <div
      className="history-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Transcript history"
    >
      <div className="history-panel">
        <div className="history-header">
          <h2>📜 Transcript History</h2>
          <div className="history-actions">
            <button
              className="sketch-btn btn-sm"
              onClick={loadHistory}
              disabled={loading}
              aria-label="Refresh history"
            >
              {loading ? "⟳" : "↻"} Refresh
            </button>
            <button
              className="sketch-btn btn-sm"
              onClick={onClose}
              aria-label="Close history"
            >
              ✕ Close
            </button>
          </div>
        </div>
        {error && <div className="history-error" role="alert">⚠ {error}</div>}
        <div className="history-list" role="list">
          {rows.length === 0 && !loading && (
            <p className="history-empty">No transcripts yet. Start recording to build your history.</p>
          )}
          {rows.map((row) => (
            <div key={row.id} className="history-card" role="listitem">
              <div className="history-card-header">
                <span className="history-mode">{row.mode}</span>
                <span className="history-time">{formatDate(row.created_at)}</span>
              </div>
              <div className="history-card-raw">
                <span className="history-label">Raw:</span> {row.raw_text}
              </div>
              {row.processed_text && row.processed_text !== row.raw_text && (
                <div className="history-card-proc">
                  <span className="history-label">Corrected:</span> {row.processed_text}
                </div>
              )}
              <div className="history-card-footer">
                <span className="history-meta">{row.language} · {row.model || "default"} · {row.duration_sec?.toFixed(1)}s</span>
                <button
                  className="sketch-btn btn-sm"
                  onClick={() => copyText(row.processed_text || row.raw_text, row.id)}
                  aria-label={`Copy transcript: ${row.raw_text.substring(0, 30)}...`}
                >
                  {copiedId === row.id ? "Copied!" : "📋 Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
