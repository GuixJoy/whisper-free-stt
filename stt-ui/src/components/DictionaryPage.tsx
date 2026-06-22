import { useState, useMemo, useCallback, useEffect } from "react";
import { BookOpen, Plus, Star, Pencil, Trash2, Search, X, Upload, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import TabSwitcher from "@/components/TabSwitcher";
import {
  CATEGORY_META,
  type DictionaryCategory,
} from "@/data/mockDictionaryData";

const API_BASE = "http://127.0.0.1:8765/api";

const isTauri = (): boolean =>
  typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

export interface DictionaryEntry {
  id: number;
  phrase: string;
  replacement: string;
  category: string;
  notes: string;
  use_count: number;
  is_favorite: boolean;
  auto_learned: boolean;
  created_at: string;
  updated_at: string;
}

const TABS = [
  { id: "all", label: "All" },
  { id: "name", label: "Names" },
  { id: "technical", label: "Technical" },
  { id: "abbreviation", label: "Abbreviations" },
  { id: "favorites", label: "Favorites" },
];

const CATEGORY_OPTIONS: { value: DictionaryCategory; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "technical", label: "Technical" },
  { value: "abbreviation", label: "Abbreviation" },
  { value: "custom", label: "Custom" },
];

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-14 h-14 rounded-full bg-app-surface-secondary flex items-center justify-center">
        <BookOpen className="w-6 h-6 text-text-muted" />
      </div>
      <p className="text-text-primary text-[15px] font-medium">No matching terms found</p>
      <p className="text-text-muted text-[13px]">
        {query ? "Try a different search or add a new word." : "Add your first custom word to get started."}
      </p>
    </div>
  );
}

function EntryCard({
  entry,
  onEdit,
  onDelete,
  onToggleFavorite,
}: {
  entry: DictionaryEntry;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}) {
  const cat = CATEGORY_META[entry.category as DictionaryCategory] ?? CATEGORY_META.custom;

  return (
    <div
      className="group flex items-center gap-4 px-5 py-4 rounded-[14px] bg-app-surface-secondary border border-border transition-all duration-200 hover:translate-y-[-1px] hover:border-border-hover"
    >
      {/* Left: phrase & replacement */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-[15px] font-medium truncate">
            {entry.phrase}
          </span>
          {entry.auto_learned && (
            <span className="text-[13px]" title="Auto-learned">✨</span>
          )}
          <span className="text-text-muted text-[15px]">→</span>
          <span className="text-text-secondary text-[15px] truncate">
            {entry.replacement}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-[6px] text-[11px] font-medium"
            style={{ color: cat.color, backgroundColor: cat.bg }}
          >
            {cat.label}
          </span>
          <span className="text-text-disabled text-[12px]">
            Triggered {entry.use_count} times
          </span>
          {entry.notes && (
            <span className="text-text-disabled text-[12px] truncate max-w-[200px]">
              {entry.notes}
            </span>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onToggleFavorite}
          className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-border-hover transition-colors"
          title={entry.is_favorite ? "Unpin" : "Pin to top"}
        >
          <Star
            className={cn(
              "w-4 h-4 transition-colors",
              entry.is_favorite ? "fill-[#D4883A] text-sunset" : "text-text-disabled"
            )}
          />
        </button>
        <button
          onClick={onEdit}
          className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-border-hover transition-colors"
          title="Edit"
        >
          <Pencil className="w-4 h-4 text-text-disabled" />
        </button>
        <button
          onClick={onDelete}
          className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-border-hover transition-colors"
          title="Delete"
        >
          <Trash2 className="w-4 h-4 text-text-disabled hover:text-[#E55353]" />
        </button>
      </div>
    </div>
  );
}

function EntryModal({
  entry,
  onSave,
  onClose,
}: {
  entry: DictionaryEntry | null;
  onSave: (data: { phrase: string; replacement: string; category: string; notes: string }) => void;
  onClose: () => void;
}) {
  const [phrase, setPhrase] = useState(entry?.phrase ?? "");
  const [replacement, setReplacement] = useState(entry?.replacement ?? "");
  const [category, setCategory] = useState(entry?.category ?? "custom");
  const [notes, setNotes] = useState(entry?.notes ?? "");

  const isValid = phrase.trim().length > 0 && replacement.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[rgba(44,37,32,0.4)] backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[440px] mx-4 rounded-[20px] bg-app-surface-dark border border-border-hover shadow-2xl">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-text-primary text-[16px] font-semibold">
            {entry ? "Edit Word" : "Add Word"}
          </h3>
          <p className="text-text-muted text-[13px] mt-1">
            Add a custom word, name, or abbreviation to your dictionary.
          </p>
        </div>

        <div className="px-6 space-y-4 pb-4">
          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">
              Phrase
            </label>
            <input
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="e.g. CEO, Tauri, Snehaa"
              className="w-full h-10 px-3 rounded-[10px] bg-app-surface-secondary border border-border text-text-primary text-[14px] placeholder:text-text-disabled outline-none focus:border-accent focus:bg-accent-focus-surface transition-colors"
            />
          </div>

          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">
              Replacement
            </label>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="e.g. Chief Executive Officer"
              className="w-full h-10 px-3 rounded-[10px] bg-app-surface-secondary border border-border text-text-primary text-[14px] placeholder:text-text-disabled outline-none focus:border-accent focus:bg-accent-focus-surface transition-colors"
            />
          </div>

          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">
              Category
            </label>
            <div className="flex gap-2">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCategory(opt.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-all duration-150",
                    category === opt.value
                      ? "bg-accent-surface text-accent border border-[rgba(255,59,86,0.15)]"
                      : "bg-app-surface-secondary text-text-muted border border-border hover:border-border-hover"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">
              Notes <span className="text-text-disabled">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context or usage notes"
              className="w-full h-10 px-3 rounded-[10px] bg-app-surface-secondary border border-border text-text-primary text-[14px] placeholder:text-text-disabled outline-none focus:border-accent focus:bg-accent-focus-surface transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 pb-6">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!isValid}
            onClick={() => {
              if (isValid) {
                onSave({ phrase: phrase.trim(), replacement: replacement.trim(), category, notes: notes.trim() });
              }
            }}
          >
            {entry ? "Save Changes" : "Add Word"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  phrase,
  onConfirm,
  onCancel,
}: {
  phrase: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[rgba(44,37,32,0.4)] backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-[380px] mx-4 rounded-[20px] bg-app-surface-dark border border-border-hover shadow-2xl p-6">
        <h3 className="text-text-primary text-[16px] font-semibold">Delete Word</h3>
        <p className="text-text-muted text-[14px] mt-2">
          Are you sure you want to remove <span className="text-text-primary font-medium">"{phrase}"</span> from your dictionary? This cannot be undone.
        </p>
        <div className="flex items-center justify-end gap-2 mt-6">
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
      </div>
    </div>
  );
}

export default function DictionaryPage() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<DictionaryEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<DictionaryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);

  const apiFetch = useCallback(async (path: string, options?: RequestInit) => {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const data = await invoke<DictionaryEntry[]>("get_dictionary");
        setEntries(data);
      } else {
        const data = await apiFetch("/dictionary");
        setEntries(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const toggleFavorite = useCallback(async (id: number) => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("toggle_dictionary_favorite", { id });
      } else {
        await apiFetch(`/dictionary/${id}/favorite`, { method: "POST" });
      }
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, is_favorite: !e.is_favorite } : e))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiFetch]);

  const deleteEntry = useCallback(async (id: number) => {
    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("delete_dictionary_entry", { id });
      } else {
        await apiFetch(`/dictionary/${id}`, { method: "DELETE" });
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setDeletingEntry(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiFetch]);

  const saveEntry = useCallback(
    async (data: { phrase: string; replacement: string; category: string; notes: string }) => {
      try {
        if (editingEntry) {
          if (isTauri()) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("update_dictionary_entry", { id: editingEntry.id, ...data });
          } else {
            await apiFetch(`/dictionary/${editingEntry.id}`, {
              method: "PUT",
              body: JSON.stringify(data),
            });
          }
          setEntries((prev) =>
            prev.map((e) =>
              e.id === editingEntry.id
                ? { ...e, ...data, updated_at: new Date().toISOString() }
                : e
            )
          );
        } else {
          if (isTauri()) {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("add_dictionary_entry", data);
          } else {
            await apiFetch("/dictionary", {
              method: "POST",
              body: JSON.stringify(data),
            });
          }
          await loadEntries();
        }
        setModalOpen(false);
        setEditingEntry(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [editingEntry, apiFetch, loadEntries],
  );

  const handleImportCSV = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 3 * 1024 * 1024) {
        setError("File too large (max 3MB)");
        return;
      }
      setImporting(true);
      try {
        const text = await file.text();
        if (isTauri()) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("import_dictionary_csv", { csvText: text });
        } else {
          await apiFetch("/dictionary/import", {
            method: "POST",
            body: JSON.stringify({ csv_text: text }),
          });
        }
        await loadEntries();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }, [apiFetch, loadEntries]);

  const handleExportCSV = useCallback(async () => {
    try {
      let csvText: string;
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<{ csv: string }>("export_dictionary_csv");
        csvText = result.csv;
      } else {
        const data = await apiFetch("/dictionary/export/csv");
        csvText = data.csv;
      }
      const blob = new Blob([csvText], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stt-dictionary-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiFetch]);

  const filtered = useMemo(() => {
    let result = entries;

    if (activeTab === "favorites") {
      result = result.filter((e) => e.is_favorite);
    } else if (activeTab !== "all") {
      result = result.filter((e) => e.category === activeTab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          e.phrase.toLowerCase().includes(q) ||
          e.replacement.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q),
      );
    }

    return result;
  }, [entries, activeTab, search]);

  const pinned = useMemo(() => filtered.filter((e) => e.is_favorite), [filtered]);
  const unpinned = useMemo(() => filtered.filter((e) => !e.is_favorite), [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: entries.length };
    for (const e of entries) {
      c[e.category] = (c[e.category] ?? 0) + 1;
    }
    c.favorites = entries.filter((e) => e.is_favorite).length;
    return c;
  }, [entries]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-text-primary text-[22px] font-semibold tracking-tight">
              Dictionary
            </h1>
            <p className="text-text-muted text-[13px] mt-1">
              Manage custom words, names, abbreviations, and terminology.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleImportCSV}
              disabled={importing}
              className="gap-1"
              title="Import CSV"
            >
              <Upload className="w-4 h-4" />
              {importing ? "Importing..." : "Import"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExportCSV}
              className="gap-1"
              title="Export CSV"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingEntry(null);
                setModalOpen(true);
              }}
              className="gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Word
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-2 rounded-[10px] bg-[rgba(229,83,83,0.1)] border border-[rgba(229,83,83,0.2)] text-[#E55353] text-[13px]">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-disabled" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dictionary..."
                className="w-full h-10 pl-10 pr-10 rounded-[10px] bg-app-surface-secondary border border-border text-text-primary text-[14px] placeholder:text-text-disabled outline-none focus:border-accent focus:bg-accent-focus-surface transition-colors"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full hover:bg-border-hover transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-text-disabled" />
                </button>
              )}
            </div>

            {/* Category Tabs */}
            <div className="mb-6">
              <TabSwitcher
                tabs={TABS.map((t) => ({
                  ...t,
                  label: t.id === "all"
                    ? `All (${counts.all ?? 0})`
                    : t.id === "favorites"
                      ? `Favorites (${counts.favorites ?? 0})`
                      : `${t.label} (${counts[t.id] ?? 0})`,
                }))}
                activeTab={activeTab}
                onChange={setActiveTab}
              />
            </div>

            {/* Content */}
            {filtered.length === 0 ? (
              <EmptyState query={search} />
            ) : (
              <div className="space-y-6">
                {/* Pinned Section */}
                {pinned.length > 0 && (
                  <div>
                    <h2 className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3 px-1">
                      Pinned Terms
                    </h2>
                    <div className="space-y-2">
                      {pinned.map((entry) => (
                        <EntryCard
                          key={entry.id}
                          entry={entry}
                          onEdit={() => {
                            setEditingEntry(entry);
                            setModalOpen(true);
                          }}
                          onDelete={() => setDeletingEntry(entry)}
                          onToggleFavorite={() => toggleFavorite(entry.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* All entries */}
                {unpinned.length > 0 && (
                  <div>
                    {pinned.length > 0 && (
                      <h2 className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3 px-1">
                        All Terms
                      </h2>
                    )}
                    <div className="space-y-2">
                      {unpinned.map((entry) => (
                        <EntryCard
                          key={entry.id}
                          entry={entry}
                          onEdit={() => {
                            setEditingEntry(entry);
                            setModalOpen(true);
                          }}
                          onDelete={() => setDeletingEntry(entry)}
                          onToggleFavorite={() => toggleFavorite(entry.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {modalOpen && (
        <EntryModal
          entry={editingEntry}
          onSave={saveEntry}
          onClose={() => {
            setModalOpen(false);
            setEditingEntry(null);
          }}
        />
      )}
      {deletingEntry && (
        <DeleteConfirm
          phrase={deletingEntry.phrase}
          onConfirm={() => deleteEntry(deletingEntry.id)}
          onCancel={() => setDeletingEntry(null)}
        />
      )}
    </div>
  );
}
