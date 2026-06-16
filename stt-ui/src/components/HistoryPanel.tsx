import { useEffect, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

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
    const d = new Date(iso + (iso.includes("Z") ? "" : "Z"));
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
  const wsRef = useRef<WebSocket | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (isTauri()) {
        // Tauri mode: use Rust command
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<HistoryRow[]>("get_history", { limit: 100 });
        setRows(result);
      } else {
        // Browser mode: fetch via WebSocket
        const ws = new WebSocket(`ws://127.0.0.1:8765`);
        wsRef.current = ws;

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error("WebSocket connection failed"));
        });

        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data.type === "history") {
              setRows(data.rows);
              setLoading(false);
              ws.close();
            }
          } catch { }
        };

        ws.send(JSON.stringify({ type: "get_history", limit: 100 }));

        // Timeout in case no response
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            setError("Timeout fetching history");
            setLoading(false);
            ws.close();
          }
        }, 5000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      setRows([]);
      return;
    }
    loadHistory();
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, [visible, loadHistory]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Transcript history"
    >
      <div className="bg-app-surface rounded-card border border-border w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-heading text-text-primary">📜 Transcript History</h2>
          <div className="flex items-center gap-2">
            <button
              className={cn(
                "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
                "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              onClick={loadHistory}
              disabled={loading}
              aria-label="Refresh history"
            >
              {loading ? "⟳" : "↻"} Refresh
            </button>
            <button
              className={cn(
                "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
                "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              )}
              onClick={onClose}
              aria-label="Close history"
            >
              ✕ Close
            </button>
          </div>
        </div>
        {error && (
          <div className="mx-6 mt-4 rounded-card bg-red-900/20 border border-red-500/30 px-4 py-3 text-body text-red-400" role="alert">
            ⚠ {error}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" role="list">
          {rows.length === 0 && !loading && (
            <p className="text-center text-text-muted text-body py-12">No transcripts yet. Start recording to build your history.</p>
          )}
          {rows.map((row) => (
            <div key={row.id} className="bg-app-surface-secondary rounded-card border border-border p-4 flex flex-col gap-2" role="listitem">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center rounded-badge px-3 py-1 text-label font-semibold bg-accent-muted border border-accent-muted-border text-accent-light">
                  {row.mode}
                </span>
                <span className="text-small text-text-muted">{formatDate(row.created_at)}</span>
              </div>
              <div className="text-body text-text-primary">
                <span className="text-text-secondary font-medium">Raw:</span> {row.raw_text}
              </div>
              {row.processed_text && row.processed_text !== row.raw_text && (
                <div className="text-body text-text-primary">
                  <span className="text-text-secondary font-medium">Corrected:</span> {row.processed_text}
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-border">
                <span className="text-small text-text-muted">{row.language} · {row.model || "default"} · {row.duration_sec?.toFixed(1)}s</span>
                <button
                  className={cn(
                    "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
                    "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                  )}
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
