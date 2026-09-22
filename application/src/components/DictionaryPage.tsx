import { useState, useMemo, useCallback, useEffect } from "react";
import { BookOpen, Plus, Star, Pencil, Trash2, Search, X, Upload, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseAppError } from "@/lib/errors";
import { Button } from "@/components/Button";
import TabSwitcher from "@/components/TabSwitcher";
import Dialog from "@/components/Dialog";
import { CATEGORY_META, type DictionaryCategory } from "@/data/mockDictionaryData";

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
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-app-surface-secondary">
        <BookOpen className="h-6 w-6 text-text-muted" />
      </div>
      <p className="text-[15px] font-medium text-text-primary">No matching terms found</p>
      <p className="text-[13px] text-text-muted">
        {query
          ? "Try a different search or add a new word."
          : "Add your first custom word to get started."}
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
    <div className="group flex items-center gap-4 rounded-[14px] border border-border bg-app-surface-secondary px-5 py-4 transition duration-200 hover:translate-y-[-1px] hover:border-border-hover">
      {/* Left: phrase & replacement */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium text-text-primary">{entry.phrase}</span>
          {entry.auto_learned && (
            <span
              className="rounded bg-app-surface-secondary px-1.5 py-0.5 text-[11px] font-medium text-text-muted"
              title="Auto-learned"
            >
              auto
            </span>
          )}
          <span className="text-[15px] text-text-muted">→</span>
          <span className="truncate text-[15px] text-text-secondary">{entry.replacement}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <span
            className="inline-flex items-center rounded-[6px] px-2 py-0.5 text-[11px] font-medium"
            style={{ color: cat.color, backgroundColor: cat.bg }}
          >
            {cat.label}
          </span>
          <span className="text-[12px] text-text-muted">Triggered {entry.use_count} times</span>
          {entry.notes && (
            <span className="max-w-[200px] truncate text-[12px] text-text-muted">
              {entry.notes}
            </span>
          )}
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          onClick={onToggleFavorite}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors hover:bg-border-hover"
          title={entry.is_favorite ? "Unpin" : "Pin to top"}
          aria-label={entry.is_favorite ? "Unpin from top" : "Pin to top"}
          aria-pressed={!!entry.is_favorite}
        >
          <Star
            className={cn(
              "h-4 w-4 transition-colors",
              entry.is_favorite ? "fill-[#D4883A] text-sunset" : "text-text-muted",
            )}
          />
        </button>
        <button
          onClick={onEdit}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors hover:bg-border-hover"
          title="Edit"
          aria-label={`Edit ${entry.phrase}`}
        >
          <Pencil className="h-4 w-4 text-text-muted" />
        </button>
        <button
          onClick={onDelete}
          className="flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors hover:bg-border-hover"
          title="Delete"
          aria-label={`Delete ${entry.phrase}`}
        >
          <Trash2 className="h-4 w-4 text-text-muted hover:text-red-600" />
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
    <Dialog
      onClose={onClose}
      label={entry ? "Edit Word" : "Add Word"}
      className="max-w-[440px] border-border-hover bg-app-surface-dark"
    >
      <div className="px-6 pb-4 pt-6">
        <h3 className="text-[16px] font-semibold text-text-primary">
          {entry ? "Edit Word" : "Add Word"}
        </h3>
        <p className="mt-1 text-[13px] text-text-muted">
          Add a custom word, name, or abbreviation to your dictionary.
        </p>
      </div>

      <div className="max-h-[55vh] space-y-4 overflow-y-auto overscroll-contain px-6 pb-4">
        <div>
          <label
            htmlFor="dict-phrase"
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            Phrase
          </label>
          <input
            id="dict-phrase"
            name="phrase"
            autoComplete="off"
            type="text"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="e.g. CEO, Tauri, Snehaa"
            className="h-10 w-full rounded-[10px] border border-border bg-app-surface-secondary px-3 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:bg-accent-focus-surface focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </div>

        <div>
          <label
            htmlFor="dict-replacement"
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            Replacement
          </label>
          <input
            id="dict-replacement"
            name="replacement"
            autoComplete="off"
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="e.g. Chief Executive Officer"
            className="h-10 w-full rounded-[10px] border border-border bg-app-surface-secondary px-3 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:bg-accent-focus-surface focus-visible:ring-2 focus-visible:ring-accent/30"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-text-secondary">
            Category
          </label>
          <div className="flex gap-2">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setCategory(opt.value)}
                className={cn(
                  "rounded-[8px] px-3 py-1.5 text-[12px] font-medium transition-colors duration-150",
                  category === opt.value
                    ? "border border-[rgba(255,59,86,0.15)] bg-accent-surface text-accent-active"
                    : "border border-border bg-app-surface-secondary text-text-muted hover:border-border-hover",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="dict-notes"
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            Notes <span className="text-text-muted">(optional)</span>
          </label>
          <input
            id="dict-notes"
            name="notes"
            autoComplete="off"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. spoken in weekly standups"
            className="h-10 w-full rounded-[10px] border border-border bg-app-surface-secondary px-3 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:bg-accent-focus-surface focus-visible:ring-2 focus-visible:ring-accent/30"
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
              onSave({
                phrase: phrase.trim(),
                replacement: replacement.trim(),
                category,
                notes: notes.trim(),
              });
            }
          }}
        >
          {entry ? "Save Changes" : "Add Word"}
        </Button>
      </div>
    </Dialog>
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
    <Dialog
      onClose={onCancel}
      label="Delete Word"
      className="max-w-[380px] border-border-hover bg-app-surface-dark p-6"
    >
      <h3 className="text-[16px] font-semibold text-text-primary">Delete Word</h3>
      <p className="mt-2 text-[14px] text-text-muted">
        Are you sure you want to remove{" "}
        <span className="font-medium text-text-primary">"{phrase}"</span> from your dictionary? This
        cannot be undone.
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

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const data = await invoke<DictionaryEntry[]>("get_dictionary");
      setEntries(data ?? []);
    } catch (e) {
      setError(parseAppError(e).message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const toggleFavorite = useCallback(async (id: number) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("toggle_dictionary_favorite", { id });
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, is_favorite: !e.is_favorite } : e)),
      );
    } catch (e) {
      setError(parseAppError(e).message);
    }
  }, []);

  const deleteEntry = useCallback(async (id: number) => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("delete_dictionary_entry", { id });
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setDeletingEntry(null);
    } catch (e) {
      setError(parseAppError(e).message);
    }
  }, []);

  const saveEntry = useCallback(
    async (data: { phrase: string; replacement: string; category: string; notes: string }) => {
      try {
        if (editingEntry) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("update_dictionary_entry", { id: editingEntry.id, ...data });
          setEntries((prev) =>
            prev.map((e) =>
              e.id === editingEntry.id
                ? { ...e, ...data, updated_at: new Date().toISOString() }
                : e,
            ),
          );
        } else {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("add_dictionary_entry", data);
          await loadEntries();
        }
        setModalOpen(false);
        setEditingEntry(null);
      } catch (e) {
        setError(parseAppError(e).message);
      }
    },
    [editingEntry, loadEntries],
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
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("import_dictionary_csv", { csvText: text });
        await loadEntries();
      } catch (e) {
        setError(parseAppError(e).message);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }, [loadEntries]);

  const handleExportCSV = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ csv: string }>("export_dictionary_csv");
      const csvText = result?.csv ?? "";
      const blob = new Blob([csvText], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stt-dictionary-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(parseAppError(e).message);
    }
  }, []);

  const filtered = useMemo(() => {
    let result = Array.isArray(entries) ? entries : [];

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
    <div className="flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-[680px] px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-balance text-[22px] font-semibold tracking-tight text-text-primary">
              Dictionary
            </h2>
            <p className="mt-1 text-[13px] text-text-muted">
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
              <Upload className="h-4 w-4" />
              {importing ? "Importing…" : "Import"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExportCSV}
              className="gap-1"
              title="Export CSV"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingEntry(null);
                setModalOpen(true);
              }}
              className="shrink-0 gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add Word
            </Button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-[10px] border border-[rgba(229,83,83,0.2)] bg-[rgba(229,83,83,0.1)] px-4 py-2 text-[13px] text-[#E55353]">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                name="dictionary-search"
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search dictionary…"
                aria-label="Search dictionary"
                className="h-10 w-full rounded-[10px] border border-border bg-app-surface-secondary pl-10 pr-10 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent focus:bg-accent-focus-surface focus-visible:ring-2 focus-visible:ring-accent/30"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-border-hover"
                >
                  <X className="h-3.5 w-3.5 text-text-muted" />
                </button>
              )}
            </div>

            {/* Category Tabs */}
            <div className="mb-6">
              <TabSwitcher
                tabs={TABS.map((t) => ({
                  ...t,
                  label:
                    t.id === "all"
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
                    <h2 className="mb-3 text-balance px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
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
                      <h2 className="mb-3 text-balance px-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
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
