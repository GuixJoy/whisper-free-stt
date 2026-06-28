import { useEffect, useState, useCallback, useMemo } from "react";
import { Search, Download, Trash2, ArrowLeft, CheckSquare, Square, Calendar, Filter } from "lucide-react";

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
const PAGE_SIZE = 50;

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso + (iso.includes("Z") ? "" : "Z"));
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return time;
    if (isYesterday) return `Yesterday ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  } catch {
    return iso;
  }
}

function getDateGroup(iso: string): string {
  try {
    const d = new Date(iso + (iso.includes("Z") ? "" : "Z"));
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return "Today";
    if (isYesterday) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } catch {
    return "Unknown";
  }
}

interface Props {
  onBack: () => void;
}

export default function HistoryPage({ onBack }: Props) {
  const [allRows, setAllRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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
        const result = await invoke<HistoryRow[]>("get_history", { limit: 2000 });
        setAllRows(result);
      } else {
        const data = await apiFetch("/history?limit=2000");
        setAllRows(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let result = allRows;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(r => r.raw_text.toLowerCase().includes(q) || r.processed_text.toLowerCase().includes(q));
    }
    if (modeFilter !== "all") {
      result = result.filter(r => r.mode === modeFilter);
    }
    return result;
  }, [allRows, searchQuery, modeFilter]);

  // Visible rows (pagination)
  const visibleRows = useMemo(() => filteredRows.slice(0, visibleCount), [filteredRows, visibleCount]);
  const hasMore = visibleCount < filteredRows.length;

  // Date groups
  const groupedRows = useMemo(() => {
    const groups: { label: string; rows: HistoryRow[] }[] = [];
    let currentGroup = "";
    for (const row of visibleRows) {
      const group = getDateGroup(row.created_at);
      if (group !== currentGroup) {
        currentGroup = group;
        groups.push({ label: group, rows: [] });
      }
      groups[groups.length - 1].rows.push(row);
    }
    return groups;
  }, [visibleRows]);

  // Available modes for filter dropdown
  const availableModes = useMemo(() => {
    const modes = new Set(allRows.map(r => r.mode).filter(Boolean));
    return Array.from(modes).sort();
  }, [allRows]);

  const exportHistory = useCallback(async (format: "csv" | "text") => {
    try {
      const resp = await fetch(`${API_BASE}/export/${format}`);
      const content = await resp.text();
      const blob = new Blob([content], { type: format === "csv" ? "text/csv" : "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stt-history-${new Date().toISOString().split("T")[0]}.${format === "csv" ? "csv" : "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { }
  }, []);

  const deleteEntry = useCallback(async (id: number) => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_entry", { id });
      } else {
        await apiFetch(`/history/${id}`, { method: "DELETE" });
      }
      setAllRows((prev) => prev.filter((r) => r.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch { }
  }, [apiFetch]);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        for (const id of ids) {
          await invoke("delete_entry", { id });
        }
      } else {
        for (const id of ids) {
          await apiFetch(`/history/${id}`, { method: "DELETE" });
        }
      }
      setAllRows((prev) => prev.filter((r) => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
    } catch { }
  }, [selectedIds, apiFetch]);

  const toggleFavorite = useCallback(async (id: number) => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{ favorite: number }>("toggle_favorite", { id });
        setAllRows((prev) => prev.map((r) => r.id === id ? { ...r, favorite: result.favorite } : r));
      } else {
        const result = await apiFetch(`/history/${id}/favorite`, { method: "POST" });
        setAllRows((prev) => prev.map((r) => r.id === id ? { ...r, favorite: result.favorite } : r));
      }
    } catch { }
  }, [apiFetch]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === visibleRows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleRows.map(r => r.id)));
    }
  }, [selectedIds, visibleRows]);

  const copyText = async (text: string, id: number) => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const ok = await copyToClipboard(text);
    if (ok) { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); }
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-border transition-colors">
            <ArrowLeft size={18} className="text-text-secondary" />
          </button>
          <h1 className="text-[32px] font-semibold text-text-primary">History</h1>
          {filteredRows.length > 0 && (
            <span className="text-[13px] text-text-muted">{filteredRows.length} transcripts</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={deleteSelected}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[12px] text-[13px] font-medium text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={14} /> Delete ({selectedIds.size})
            </button>
          )}
          <button onClick={() => exportHistory("csv")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[12px] text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-border transition-colors">
            <Download size={14} /> CSV
          </button>
          <button onClick={() => exportHistory("text")} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[12px] text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-border transition-colors">
            <Download size={14} /> Text
          </button>
          <button onClick={loadHistory} disabled={loading} className="flex items-center justify-center w-9 h-9 rounded-[12px] text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-border transition-colors disabled:opacity-50">
            {loading ? "⟳" : "↻"}
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-2 mb-4">
        <Search size={16} className="text-text-muted shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(PAGE_SIZE); }}
          placeholder="Search transcripts..."
          className="flex-1 h-10 px-4 bg-app-surface-secondary border border-border rounded-[12px] text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:bg-accent-focus-surface"
        />
        {availableModes.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-text-muted" />
            <select
              value={modeFilter}
              onChange={(e) => { setModeFilter(e.target.value); setVisibleCount(PAGE_SIZE); }}
              className="h-10 px-3 bg-app-surface-secondary border border-border rounded-[12px] text-[13px] text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="all">All modes</option>
              {availableModes.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        {searchQuery && (
          <button onClick={() => { setSearchQuery(""); setVisibleCount(PAGE_SIZE); }} className="text-text-muted hover:text-text-primary text-[13px]">Clear</button>
        )}
        <button
          onClick={toggleSelectAll}
          className="flex items-center justify-center w-9 h-9 rounded-[12px] text-text-muted hover:text-text-primary hover:bg-border transition-colors"
          title={selectedIds.size === visibleRows.length ? "Deselect all" : "Select all"}
        >
          <CheckSquare size={16} />
        </button>
      </div>

      {error && <div className="mb-4 rounded-[12px] bg-red-900/20 border border-red-500/30 px-4 py-3 text-[14px] text-red-400">⚠ {error}</div>}

      {/* List */}
      <div className="flex-1 overflow-auto space-y-4">
        {filteredRows.length === 0 && !loading && (
          <p className="text-center text-text-muted text-[15px] py-12">No transcripts yet.</p>
        )}
        {groupedRows.map((group) => (
          <div key={group.label}>
            {/* Date header */}
            <div className="flex items-center gap-2 mb-2 sticky top-0 z-10 bg-[#FAF8F5] py-1">
              <Calendar size={12} className="text-text-muted" />
              <span className="text-[12px] font-semibold text-text-muted uppercase tracking-wide">{group.label}</span>
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] text-text-muted">{group.rows.length}</span>
            </div>
            {/* Rows */}
            <div className="space-y-2">
              {group.rows.map((row) => (
                <div key={row.id} className="group bg-app-surface-secondary rounded-[16px] border border-border p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSelect(row.id)}
                        className="text-text-muted hover:text-text-primary transition-colors"
                      >
                        {selectedIds.has(row.id) ? <CheckSquare size={16} className="text-accent" /> : <Square size={16} />}
                      </button>
                      <button onClick={() => toggleFavorite(row.id)} className={`text-lg transition-colors ${row.favorite ? "text-yellow-400" : "text-text-muted hover:text-yellow-400"}`}>
                        {row.favorite ? "★" : "☆"}
                      </button>
                      <span className="inline-flex items-center rounded-[8px] px-2.5 py-0.5 text-[11px] font-semibold bg-accent/10 border border-accent/22 text-accent">
                        {row.mode}
                      </span>
                    </div>
                    <span className="text-[12px] text-text-muted">{formatTimestamp(row.created_at)}</span>
                  </div>
                  <div className="text-[15px] text-text-primary whitespace-pre-wrap break-words">
                    {row.processed_text && row.processed_text !== row.raw_text ? (
                      <>
                        <span className="text-text-muted">Raw:</span> {row.raw_text}
                        <br />
                        <span className="text-text-muted">Cleaned:</span> {row.processed_text}
                      </>
                    ) : (
                      row.raw_text
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border">
                    <span className="text-[12px] text-text-muted">{row.language} · {row.model || "default"} · {row.duration_sec?.toFixed(1)}s</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => copyText(row.processed_text || row.raw_text, row.id)} className="inline-flex items-center h-8 px-3 rounded-[10px] text-[12px] font-medium bg-border border border-border text-text-muted hover:text-text-primary transition-colors">
                        {copiedId === row.id ? "Copied!" : "Copy"}
                      </button>
                      <button onClick={() => deleteEntry(row.id)} className="inline-flex items-center h-8 px-2 rounded-[10px] text-[12px] font-medium text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {hasMore && (
          <div className="flex justify-center py-4">
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="inline-flex items-center h-10 px-6 rounded-[12px] text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-border transition-colors"
            >
              Load more ({filteredRows.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
