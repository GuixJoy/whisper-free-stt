import { useEffect, useState, useCallback } from "react";
import { Search, Download, Trash2 } from "lucide-react";

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

const API_BASE = "http://127.0.0.1:8765/api";

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
  const [searchQuery, setSearchQuery] = useState("");

  const apiFetch = useCallback(async (path: string, options?: RequestInit): Promise<any> => {
    const resp = await fetch(`${API_BASE}${path}`, options);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<HistoryRow[]>("get_history", { limit: 100 });
        setRows(result);
      } else {
        const data = await apiFetch("/history?limit=100");
        setRows(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  const searchHistory = useCallback(async () => {
    if (!searchQuery.trim()) { loadHistory(); return; }
    setLoading(true);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<HistoryRow[]>("get_history", { limit: 500 });
        const q = searchQuery.toLowerCase();
        setRows(result.filter(r => r.raw_text.toLowerCase().includes(q) || r.processed_text.toLowerCase().includes(q)));
      } else {
        const data = await apiFetch(`/history/search?q=${encodeURIComponent(searchQuery)}`);
        setRows(data);
      }
    } catch { }
    finally { setLoading(false); }
  }, [searchQuery, loadHistory, apiFetch]);

  const exportHistory = useCallback(async (format: "csv" | "text") => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const content = await invoke<string>("export_history");
        downloadFile(content, format);
      } else {
        const resp = await fetch(`${API_BASE}/export/${format}`);
        const content = await resp.text();
        downloadFile(content, format);
      }
    } catch { }
  }, []);

  const downloadFile = (content: string, format: string) => {
    const blob = new Blob([content], { type: format === "csv" ? "text/csv" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stt-history-${new Date().toISOString().split("T")[0]}.${format === "csv" ? "csv" : "txt"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteEntry = useCallback(async (id: number) => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_entry", { id });
      } else {
        await apiFetch(`/history/${id}`, { method: "DELETE" });
      }
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch { }
  }, [apiFetch]);

  const toggleFavorite = useCallback(async (id: number) => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{ favorite: number }>("toggle_favorite", { id });
        setRows((prev) => prev.map((r) => r.id === id ? { ...r, favorite: result.favorite } : r));
      } else {
        const result = await apiFetch(`/history/${id}/favorite`, { method: "POST" });
        setRows((prev) => prev.map((r) => r.id === id ? { ...r, favorite: result.favorite } : r));
      }
    } catch { }
  }, [apiFetch]);

  useEffect(() => {
    if (!visible) { setRows([]); setSearchQuery(""); return; }
    loadHistory();
  }, [visible, loadHistory]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, onClose]);

  const copyText = async (text: string, id: number) => {
    if (!navigator.clipboard) return;
    try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); } catch { }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true">
      <div className="bg-app-surface rounded-card border border-border w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-heading text-text-primary">📜 Transcript History</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => exportHistory("csv")} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-button text-small font-medium bg-app-surface border border-border text-text-primary hover:bg-app-hover transition-colors" title="Export CSV">
              <Download size={14} /> CSV
            </button>
            <button onClick={() => exportHistory("text")} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-button text-small font-medium bg-app-surface border border-border text-text-primary hover:bg-app-hover transition-colors" title="Export Text">
              <Download size={14} /> Text
            </button>
            <button onClick={loadHistory} disabled={loading} className="inline-flex items-center justify-center h-8 px-3 rounded-button text-small font-medium bg-app-surface border border-border text-text-primary hover:bg-app-hover transition-colors disabled:opacity-50">
              {loading ? "⟳" : "↻"}
            </button>
            <button onClick={onClose} className="inline-flex items-center justify-center h-8 px-3 rounded-button text-small font-medium bg-app-surface border border-border text-text-primary hover:bg-app-hover transition-colors">✕</button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-6 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-text-muted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") searchHistory(); }}
              placeholder="Search transcripts..."
              className="flex-1 h-9 px-3 bg-app-surface-secondary border border-border rounded-input text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
            {searchQuery && (
              <button onClick={() => { setSearchQuery(""); loadHistory(); }} className="text-text-muted hover:text-text-primary text-sm">Clear</button>
            )}
          </div>
        </div>

        {error && <div className="mx-6 mt-4 rounded-card bg-red-900/20 border border-red-500/30 px-4 py-3 text-body text-red-400">⚠ {error}</div>}

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3" role="list">
          {rows.length === 0 && !loading && (
            <p className="text-center text-text-muted text-body py-12">No transcripts yet.</p>
          )}
          {rows.map((row) => (
            <div key={row.id} className="group bg-app-surface-secondary rounded-card border border-border p-4 flex flex-col gap-2" role="listitem">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={() => toggleFavorite(row.id)} className={`text-lg transition-colors ${row.favorite ? "text-yellow-400" : "text-text-muted hover:text-yellow-400"}`} title="Toggle favorite">
                    {row.favorite ? "★" : "☆"}
                  </button>
                  <span className="inline-flex items-center rounded-badge px-3 py-1 text-label font-semibold bg-accent-muted border border-accent-muted-border text-accent-light">{row.mode}</span>
                </div>
                <span className="text-small text-text-muted">{formatDate(row.created_at)}</span>
              </div>
              <div className="text-body text-text-primary whitespace-pre-wrap break-words">
                <span className="text-text-secondary font-medium">Raw:</span> {row.raw_text}
              </div>
              {row.processed_text && row.processed_text !== row.raw_text && (
                <div className="text-body text-text-primary whitespace-pre-wrap break-words">
                  <span className="text-text-secondary font-medium">Corrected:</span> {row.processed_text}
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-border">
                <span className="text-small text-text-muted">{row.language} · {row.model || "default"} · {row.duration_sec?.toFixed(1)}s</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => copyText(row.processed_text || row.raw_text, row.id)} className="inline-flex items-center h-8 px-3 rounded-button text-small font-medium bg-app-surface border border-border text-text-primary hover:bg-app-hover transition-colors">
                    {copiedId === row.id ? "Copied!" : "📋 Copy"}
                  </button>
                  <button onClick={() => deleteEntry(row.id)} className="inline-flex items-center h-8 px-2 rounded-button text-small font-medium text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
