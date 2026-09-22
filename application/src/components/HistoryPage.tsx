import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Search,
  Download,
  Trash2,
  ArrowLeft,
  CheckSquare,
  Square,
  Calendar,
  Filter,
  Star,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { formatTimestamp } from "@/lib/utils";
import { historyToCsv, historyToText } from "@/lib/historyExport";
import { parseAppError } from "@/lib/errors";
import { Button } from "@/components/Button";
import Dialog from "@/components/Dialog";

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

const PAGE_SIZE = 50;

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
    return d.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Unknown";
  }
}

interface Props {
  onBack: () => void;
}

function DeleteConfirm({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const one = count === 1;
  return (
    <Dialog
      onClose={onCancel}
      label="Delete Transcripts"
      className="max-w-[380px] border-border-hover bg-app-surface-dark p-6"
    >
      <h3 className="text-[16px] font-semibold text-text-primary">
        {one ? "Delete transcript" : `Delete ${count} transcripts`}
      </h3>
      <p className="mt-2 text-[14px] text-text-muted">
        {one
          ? "This transcript will be removed from your history. This cannot be undone."
          : `These ${count} transcripts will be removed from your history. This cannot be undone.`}
      </p>
      <div className="mt-6 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="!bg-[#E55353]/90 hover:!bg-[#E55353]"
          onClick={onConfirm}
        >
          Delete
        </Button>
      </div>
    </Dialog>
  );
}

export default function HistoryPage({ onBack }: Props) {
  const [allRows, setAllRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<number[]>([]);
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const loadHistory = useCallback(async (search?: string) => {
    setLoading(true);
    setError("");
    try {
      const limit = search ? 50000 : 2000;
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<HistoryRow[]>("get_history", { limit });
      setAllRows(result ?? []);
    } catch (e) {
      setError(parseAppError(e).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    let result = allRows;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (r) => r.raw_text.toLowerCase().includes(q) || r.processed_text.toLowerCase().includes(q),
      );
    }
    if (modeFilter !== "all") {
      result = result.filter((r) => r.mode === modeFilter);
    }
    return result;
  }, [allRows, searchQuery, modeFilter]);

  // Visible rows (pagination)
  const visibleRows = useMemo(
    () => filteredRows.slice(0, visibleCount),
    [filteredRows, visibleCount],
  );
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
    const modes = new Set(allRows.map((r) => r.mode).filter(Boolean));
    return Array.from(modes).sort();
  }, [allRows]);

  // Built from the rows already in memory: there is no backend export command,
  // and the fetch this used to do pointed at a port nothing serves, so export
  // silently did nothing in the desktop app.
  const exportHistory = useCallback(
    (format: "csv" | "text") => {
      const content = format === "csv" ? historyToCsv(allRows) : historyToText(allRows);
      const blob = new Blob([content], { type: format === "csv" ? "text/csv" : "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stt-history-${new Date().toISOString().split("T")[0]}.${format === "csv" ? "csv" : "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [allRows],
  );

  // Destructive: only ever called from DeleteConfirm, never straight off a click.
  const deleteTranscripts = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      for (const id of ids) {
        await invoke("delete_history_entry", { id });
      }
      setAllRows((prev) => prev.filter((r) => !ids.includes(r.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    } catch (e) {
      console.error("[history] delete failed", e);
    }
  }, []);

  const toggleFavorite = useCallback(async (id: number) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const favorite = await invoke<number>("toggle_history_favorite", { id });
      setAllRows((prev) => prev.map((r) => (r.id === id ? { ...r, favorite } : r)));
    } catch (e) {
      console.error("[history] favorite toggle failed", e);
    }
  }, []);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const allVisibleSelected = visibleRows.every((r) => selectedIds.has(r.id));
    if (allVisibleSelected) {
      // Deselect only visible rows, preserve hidden selections
      const visibleIds = new Set(visibleRows.map((r) => r.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      // Add visible rows to selection
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of visibleRows) next.add(r.id);
        return next;
      });
    }
  }, [selectedIds, visibleRows]);

  const copyText = async (text: string, id: number) => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Back to home"
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-border"
          >
            <ArrowLeft size={18} className="text-text-secondary" />
          </button>
          <h2 className="text-balance text-[32px] font-semibold text-text-primary">History</h2>
          {filteredRows.length > 0 && (
            <span className="text-[13px] text-text-muted">{filteredRows.length} transcripts</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setPendingDelete(Array.from(selectedIds))}
              className="inline-flex h-9 items-center gap-1.5 rounded-[12px] px-4 text-[13px] font-medium text-red-500 transition-colors hover:bg-red-50"
            >
              <Trash2 size={14} /> Delete ({selectedIds.size})
            </button>
          )}
          <button
            onClick={() => exportHistory("csv")}
            className="inline-flex h-9 items-center gap-1.5 rounded-[12px] px-4 text-[13px] font-medium text-text-muted transition-colors hover:bg-border hover:text-text-primary"
          >
            <Download size={14} /> CSV
          </button>
          <button
            onClick={() => exportHistory("text")}
            className="inline-flex h-9 items-center gap-1.5 rounded-[12px] px-4 text-[13px] font-medium text-text-muted transition-colors hover:bg-border hover:text-text-primary"
          >
            <Download size={14} /> Text
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              loadHistory();
            }}
            disabled={loading}
            aria-label="Refresh history"
            className="flex h-9 w-9 items-center justify-center rounded-[12px] text-[13px] font-medium text-text-muted transition-colors hover:bg-border hover:text-text-primary disabled:opacity-50"
          >
            {loading ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 flex items-center gap-2">
        <Search size={16} className="shrink-0 text-text-muted" />
        <input
          type="text"
          name="history-search"
          autoComplete="off"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder="Search transcripts…"
          aria-label="Search transcripts"
          className="h-10 flex-1 rounded-[12px] border border-border bg-app-surface-secondary px-4 text-[14px] text-text-primary placeholder:text-text-muted focus:border-accent focus:bg-accent-focus-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        />
        {availableModes.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Filter size={14} className="text-text-muted" />
            <select
              value={modeFilter}
              onChange={(e) => {
                setModeFilter(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              aria-label="Filter by mode"
              className="h-10 rounded-[12px] border border-border bg-app-surface-secondary px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              <option value="all">All modes</option>
              {availableModes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
        {searchQuery && (
          <button
            onClick={() => {
              setSearchQuery("");
              setVisibleCount(PAGE_SIZE);
            }}
            className="text-[13px] text-text-muted hover:text-text-primary"
          >
            Clear
          </button>
        )}
        <button
          onClick={toggleSelectAll}
          className="flex h-9 w-9 items-center justify-center rounded-[12px] text-text-muted transition-colors hover:bg-border hover:text-text-primary"
          title={selectedIds.size === visibleRows.length ? "Deselect all" : "Select all"}
          aria-label={selectedIds.size === visibleRows.length ? "Deselect all" : "Select all"}
        >
          <CheckSquare size={16} />
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-[14px] text-red-600">
          <TriangleAlert size={16} className="shrink-0" /> {error}
        </div>
      )}

      {/* List */}
      <div className="flex-1 space-y-4 overflow-auto">
        {filteredRows.length === 0 && !loading && (
          <p className="py-12 text-center text-[15px] text-text-muted">No transcripts yet.</p>
        )}
        {groupedRows.map((group) => (
          <div key={group.label}>
            {/* Date header */}
            <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 bg-app-bg py-1">
              <Calendar size={12} className="text-text-muted" />
              <span className="text-[12px] font-semibold uppercase tracking-wide text-text-muted">
                {group.label}
              </span>
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-text-muted">{group.rows.length}</span>
            </div>
            {/* Rows */}
            <div className="space-y-2">
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  className="group flex flex-col gap-2 rounded-[16px] border border-border bg-app-surface-secondary p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSelect(row.id)}
                        aria-label={
                          selectedIds.has(row.id) ? "Deselect transcript" : "Select transcript"
                        }
                        className="text-text-muted transition-colors hover:text-text-primary"
                      >
                        {selectedIds.has(row.id) ? (
                          <CheckSquare size={16} className="text-accent" />
                        ) : (
                          <Square size={16} />
                        )}
                      </button>
                      <button
                        onClick={() => toggleFavorite(row.id)}
                        aria-label={row.favorite ? "Remove from favorites" : "Add to favorites"}
                        aria-pressed={!!row.favorite}
                        className={`transition-colors ${row.favorite ? "text-yellow-700" : "text-text-muted hover:text-yellow-700"}`}
                      >
                        <Star size={18} fill={row.favorite ? "currentColor" : "none"} />
                      </button>
                      <span className="border-accent/22 inline-flex items-center rounded-[8px] border bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent-active">
                        {row.mode}
                      </span>
                    </div>
                    <span className="text-[12px] text-text-muted">
                      {formatTimestamp(row.created_at)}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[15px] text-text-primary">
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
                  <div className="flex items-center justify-between border-t border-border pt-1">
                    <span className="text-[12px] text-text-muted">
                      {row.language} · {row.model || "default"} · {row.duration_sec?.toFixed(1)}s
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyText(row.processed_text || row.raw_text, row.id)}
                        className="inline-flex h-8 items-center rounded-[10px] border border-border bg-border px-3 text-[12px] font-medium text-text-muted transition-colors hover:text-text-primary"
                      >
                        {copiedId === row.id ? "Copied!" : "Copy"}
                      </button>
                      <button
                        onClick={() => setPendingDelete([row.id])}
                        aria-label="Delete transcript"
                        className="inline-flex h-8 items-center rounded-[10px] px-2 text-[12px] font-medium text-red-600 opacity-0 transition-colors hover:bg-red-500/10 focus-visible:opacity-100 group-hover:opacity-100"
                      >
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
              className="inline-flex h-10 items-center rounded-[12px] px-6 text-[13px] font-medium text-text-muted transition-colors hover:bg-border hover:text-text-primary"
            >
              Load more ({filteredRows.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>

      {pendingDelete.length > 0 && (
        <DeleteConfirm
          count={pendingDelete.length}
          onCancel={() => setPendingDelete([])}
          onConfirm={() => {
            const ids = pendingDelete;
            setPendingDelete([]);
            void deleteTranscripts(ids);
          }}
        />
      )}
    </div>
  );
}
