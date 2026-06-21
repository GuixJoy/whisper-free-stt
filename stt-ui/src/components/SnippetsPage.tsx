import { useState, useMemo, useCallback } from "react";
import { FileText, Plus, Star, Pencil, Trash2, Search, X, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import TabSwitcher from "@/components/TabSwitcher";
import {
  mockSnippets,
  CATEGORY_META,
  STATS,
  type Snippet,
  type SnippetCategory,
} from "@/data/mockSnippetsData";

const TABS = [
  { id: "all", label: "All" },
  { id: "template", label: "Templates" },
  { id: "prompt", label: "Prompts" },
  { id: "email", label: "Emails" },
  { id: "code", label: "Code" },
  { id: "link", label: "Links" },
  { id: "favorites", label: "Favorites" },
];

const CATEGORY_OPTIONS: { value: SnippetCategory; label: string }[] = [
  { value: "template", label: "Template" },
  { value: "prompt", label: "Prompt" },
  { value: "email", label: "Email" },
  { value: "code", label: "Code" },
  { value: "link", label: "Link" },
  { value: "personal", label: "Personal" },
];

function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex-1 px-4 py-3 rounded-[14px] bg-app-surface-secondary border border-border">
      <div className="text-text-primary text-[20px] font-semibold leading-tight">{value}</div>
      <div className="text-text-muted text-[12px] mt-0.5">{label}</div>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="w-14 h-14 rounded-full bg-app-surface-secondary flex items-center justify-center">
        <FileText className="w-6 h-6 text-text-muted" />
      </div>
      <p className="text-text-primary text-[15px] font-medium">No snippets found</p>
      <p className="text-text-muted text-[13px]">
        {query ? "Try a different search or create a new snippet." : "Create your first snippet to get started."}
      </p>
    </div>
  );
}

function SnippetCard({
  snippet,
  onCopy,
  onEdit,
  onDelete,
  onToggleFavorite,
  isCopied,
}: {
  snippet: Snippet;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  isCopied: boolean;
}) {
  const cat = CATEGORY_META[snippet.category];

  return (
    <div className="group px-5 py-4 rounded-[14px] bg-app-surface-secondary border border-border transition-all duration-200 hover:translate-y-[-1px] hover:border-border-hover">
      {/* Top: trigger + actions */}
      <div className="flex items-start justify-between mb-2">
        <span className="text-sunset text-[15px] font-mono font-medium tracking-tight">
          {snippet.trigger}
        </span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onCopy}
            className={cn(
              "w-8 h-8 flex items-center justify-center rounded-[8px] transition-colors",
              isCopied
                ? "bg-[#22C55E]/15 text-[#22C55E]"
                : "hover:bg-border-hover text-text-disabled hover:text-text-secondary",
            )}
            title="Copy to clipboard"
          >
            {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
          <button
            onClick={onToggleFavorite}
            className="w-8 h-8 flex items-center justify-center rounded-[8px] hover:bg-border-hover transition-colors"
            title={snippet.isFavorite ? "Unpin" : "Pin to top"}
          >
            <Star
              className={cn(
                "w-4 h-4 transition-colors",
                snippet.isFavorite ? "fill-[#D4883A] text-sunset" : "text-text-disabled",
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

      {/* Title */}
      <div className="text-text-primary text-[14px] font-medium mb-1">{snippet.title}</div>

      {/* Content preview */}
      <div className="text-text-muted text-[13px] leading-relaxed line-clamp-2 mb-3 whitespace-pre-wrap">
        {snippet.content}
      </div>

      {/* Bottom: badge + tags + usage */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="accent"
            className="!text-[10px] !px-2 !py-0 !h-5"
            style={{ color: cat.color, backgroundColor: cat.bg } as React.CSSProperties}
          >
            {cat.label}
          </Badge>
          {snippet.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-text-disabled text-[11px]">
              #{tag}
            </span>
          ))}
        </div>
        <span className="text-text-disabled text-[12px] shrink-0">
          Used {snippet.useCount} times
        </span>
      </div>
    </div>
  );
}

function SnippetModal({
  snippet,
  onSave,
  onClose,
}: {
  snippet: Snippet | null;
  onSave: (data: {
    title: string;
    trigger: string;
    content: string;
    category: SnippetCategory;
    tags: string[];
  }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(snippet?.title ?? "");
  const [trigger, setTrigger] = useState(snippet?.trigger ?? "");
  const [content, setContent] = useState(snippet?.content ?? "");
  const [category, setCategory] = useState<SnippetCategory>(snippet?.category ?? "template");
  const [tagsInput, setTagsInput] = useState(snippet?.tags.join(", ") ?? "");

  const isValid = title.trim().length > 0 && trigger.trim().length > 0 && content.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[rgba(44,37,32,0.4)] backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[520px] mx-4 rounded-[20px] bg-app-surface-dark border border-border-hover shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-text-primary text-[16px] font-semibold">
            {snippet ? "Edit Snippet" : "Add Snippet"}
          </h3>
          <p className="text-text-muted text-[13px] mt-1">
            Create a reusable text block with a quick trigger.
          </p>
        </div>

        <div className="px-6 space-y-4 pb-4">
          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Meeting Follow-up"
              className="w-full h-10 px-3 rounded-[10px] bg-app-surface-secondary border border-border text-text-primary text-[14px] placeholder:text-text-disabled outline-none focus:border-accent focus:bg-accent-focus-surface transition-colors"
            />
          </div>

          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">Trigger</label>
            <input
              type="text"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="e.g. /followup"
              className="w-full h-10 px-3 rounded-[10px] bg-app-surface-secondary border border-border text-sunset text-[14px] font-mono placeholder:text-text-disabled outline-none focus:border-accent focus:bg-accent-focus-surface transition-colors"
            />
          </div>

          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Enter snippet content. Use {{variable}} for dynamic placeholders."
              rows={8}
              className="w-full px-3 py-2.5 rounded-[10px] bg-app-surface-secondary border border-border text-text-primary text-[13px] leading-relaxed placeholder:text-text-disabled outline-none focus:border-accent focus:bg-accent-focus-surface transition-colors resize-none font-mono"
            />
          </div>

          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">Category</label>
            <div className="flex gap-2 flex-wrap">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setCategory(opt.value)}
                  className={cn(
                    "px-3 py-1.5 rounded-[8px] text-[12px] font-medium transition-all duration-150",
                    category === opt.value
                      ? "bg-accent-surface text-accent border border-[rgba(255,59,86,0.15)]"
                      : "bg-app-surface-secondary text-text-muted border border-border hover:border-border-hover",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-text-secondary text-[12px] font-medium mb-1.5">
              Tags <span className="text-text-disabled">(comma separated)</span>
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. sales, followup, meeting"
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
                const tags = tagsInput
                  .split(",")
                  .map((t) => t.trim().toLowerCase().replace(/^#/, ""))
                  .filter(Boolean);
                onSave({
                  title: title.trim(),
                  trigger: trigger.trim(),
                  content: content.trim(),
                  category,
                  tags,
                });
              }
            }}
          >
            {snippet ? "Save Changes" : "Add Snippet"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  title,
  onConfirm,
  onCancel,
}: {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[rgba(44,37,32,0.4)] backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-[380px] mx-4 rounded-[20px] bg-app-surface-dark border border-border-hover shadow-2xl p-6">
        <h3 className="text-text-primary text-[16px] font-semibold">Delete Snippet</h3>
        <p className="text-text-muted text-[14px] mt-2">
          Are you sure you want to delete{" "}
          <span className="text-text-primary font-medium">"{title}"</span>? This cannot be undone.
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

export default function SnippetsPage() {
  const [snippets, setSnippets] = useState<Snippet[]>(mockSnippets);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [deletingSnippet, setDeletingSnippet] = useState<Snippet | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const toggleFavorite = useCallback((id: string) => {
    setSnippets((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isFavorite: !s.isFavorite } : s)),
    );
  }, []);

  const deleteSnippet = useCallback((id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    setDeletingSnippet(null);
  }, []);

  const saveSnippet = useCallback(
    (data: {
      title: string;
      trigger: string;
      content: string;
      category: SnippetCategory;
      tags: string[];
    }) => {
      if (editingSnippet) {
        setSnippets((prev) =>
          prev.map((s) => (s.id === editingSnippet.id ? { ...s, ...data } : s)),
        );
      } else {
        const newSnippet: Snippet = {
          id: Date.now().toString(),
          ...data,
          isFavorite: false,
          useCount: 0,
          createdAt: new Date().toISOString(),
        };
        setSnippets((prev) => [newSnippet, ...prev]);
      }
      setModalOpen(false);
      setEditingSnippet(null);
    },
    [editingSnippet],
  );

  const copyToClipboard = useCallback(async (content: string, id: string) => {
    const { copyToClipboard: clipWrite } = await import("@/lib/clipboard");
    const ok = await clipWrite(content);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }, []);

  const filtered = useMemo(() => {
    let result = snippets;

    if (activeTab === "favorites") {
      result = result.filter((s) => s.isFavorite);
    } else if (activeTab !== "all") {
      result = result.filter((s) => s.category === activeTab);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.trigger.toLowerCase().includes(q) ||
          s.content.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [snippets, activeTab, search]);

  const pinned = useMemo(() => filtered.filter((s) => s.isFavorite), [filtered]);
  const unpinned = useMemo(() => filtered.filter((s) => !s.isFavorite), [filtered]);

  const mostUsed = useMemo(
    () =>
      [...snippets]
        .sort((a, b) => b.useCount - a.useCount)
        .slice(0, 3),
    [snippets],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: snippets.length };
    for (const s of snippets) {
      c[s.category] = (c[s.category] ?? 0) + 1;
    }
    c.favorites = snippets.filter((s) => s.isFavorite).length;
    return c;
  }, [snippets]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[680px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-text-primary text-[22px] font-semibold tracking-tight">Snippets</h1>
            <p className="text-text-muted text-[13px] mt-1">
              Save reusable text, prompts, links, and templates.
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditingSnippet(null);
              setModalOpen(true);
            }}
            className="gap-1.5 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Snippet
          </Button>
        </div>

        {/* Stats Row */}
        <div className="flex gap-3 mb-6">
          <StatCard value={STATS.total} label="Total Snippets" />
          <StatCard value={STATS.favorites} label="Favorites" />
          <StatCard value={STATS.totalUses.toLocaleString()} label="Total Uses" />
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-disabled" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search snippets..."
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

        {/* Most Used Section */}
        {!search && activeTab === "all" && mostUsed.length > 0 && (
          <div className="mb-6">
            <h2 className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3 px-1">
              Most Used
            </h2>
            <div className="space-y-2">
              {mostUsed.map((snippet) => (
                <SnippetCard
                  key={snippet.id}
                  snippet={snippet}
                  onCopy={() => copyToClipboard(snippet.content, snippet.id)}
                  onEdit={() => {
                    setEditingSnippet(snippet);
                    setModalOpen(true);
                  }}
                  onDelete={() => setDeletingSnippet(snippet)}
                  onToggleFavorite={() => toggleFavorite(snippet.id)}
                  isCopied={copiedId === snippet.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        {filtered.length === 0 ? (
          <EmptyState query={search} />
        ) : (
          <div className="space-y-6">
            {/* Pinned Section */}
            {pinned.length > 0 && (
              <div>
                <h2 className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3 px-1">
                  Pinned Snippets
                </h2>
                <div className="space-y-2">
                  {pinned.map((snippet) => (
                    <SnippetCard
                      key={snippet.id}
                      snippet={snippet}
                      onCopy={() => copyToClipboard(snippet.content, snippet.id)}
                      onEdit={() => {
                        setEditingSnippet(snippet);
                        setModalOpen(true);
                      }}
                      onDelete={() => setDeletingSnippet(snippet)}
                      onToggleFavorite={() => toggleFavorite(snippet.id)}
                      isCopied={copiedId === snippet.id}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* All snippets */}
            {unpinned.length > 0 && (
              <div>
                {pinned.length > 0 && (
                  <h2 className="text-text-muted text-[11px] font-semibold uppercase tracking-wider mb-3 px-1">
                    All Snippets
                  </h2>
                )}
                <div className="space-y-2">
                  {unpinned.map((snippet) => (
                    <SnippetCard
                      key={snippet.id}
                      snippet={snippet}
                      onCopy={() => copyToClipboard(snippet.content, snippet.id)}
                      onEdit={() => {
                        setEditingSnippet(snippet);
                        setModalOpen(true);
                      }}
                      onDelete={() => setDeletingSnippet(snippet)}
                      onToggleFavorite={() => toggleFavorite(snippet.id)}
                      isCopied={copiedId === snippet.id}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {modalOpen && (
        <SnippetModal
          snippet={editingSnippet}
          onSave={saveSnippet}
          onClose={() => {
            setModalOpen(false);
            setEditingSnippet(null);
          }}
        />
      )}
      {deletingSnippet && (
        <DeleteConfirm
          title={deletingSnippet.title}
          onConfirm={() => deleteSnippet(deletingSnippet.id)}
          onCancel={() => setDeletingSnippet(null)}
        />
      )}
    </div>
  );
}
