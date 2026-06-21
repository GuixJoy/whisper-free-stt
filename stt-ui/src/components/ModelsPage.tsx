import { useState } from "react";
import { cn } from "@/lib/utils";
import { useModels, formatBytes, getModelInfo } from "../hooks/useModels";
import { MODEL_CATALOG } from "../store";
import { RefreshCw, Download, Trash2, Check, AlertCircle, Loader2 } from "lucide-react";

function ModelCard({
  model,
  info,
  onDownload,
  onDelete,
}: {
  model: { name: string; backend: string; downloaded: boolean; downloading: boolean; progress: number; error: string | null; sizeBytes: number };
  info: (typeof MODEL_CATALOG)[number];
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-card border p-5 transition-all duration-200",
        model.downloaded
          ? "bg-app-surface-card border-green-500/20"
          : model.downloading
            ? "bg-app-surface-card border-accent"
            : "bg-app-surface-card border-border hover:border-border-hover",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <strong className="text-[15px] text-text-primary">{model.name}</strong>
          {info.recommended && (
            <span className="inline-flex items-center rounded-badge px-2 py-0.5 text-[11px] font-semibold bg-accent-muted border border-accent-muted-border text-accent-light">
              Recommended
            </span>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-badge px-2.5 py-0.5 text-[12px] font-semibold",
            model.backend === "faster_whisper"
              ? "bg-accent-muted border border-accent-muted-border text-accent-light"
              : "bg-app-surface border border-border text-text-secondary",
          )}
        >
          {model.backend === "faster_whisper" ? "GPU" : "CPU"}
        </span>
      </div>

      {/* Info row */}
      <div className="flex items-center gap-4 text-[13px] text-text-muted">
        <span>{info.size}</span>
        <span>{info.speed}</span>
        <span>{info.accuracy}</span>
        {model.downloaded && model.sizeBytes > 0 && (
          <span className="text-green-400">{formatBytes(model.sizeBytes)}</span>
        )}
      </div>
      <p className="text-[13px] text-text-secondary">{info.bestFor}</p>

      {/* Progress bar (downloading) */}
      {model.downloading && (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 rounded-full bg-app-surface-secondary overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-[width] duration-150"
              style={{ width: `${model.progress}%` }}
            />
          </div>
          <span className="text-[12px] text-text-secondary">
            {model.progress > 0 ? `${model.progress}%` : "Preparing download..."}
          </span>
        </div>
      )}

      {/* Error */}
      {model.error && (
        <div className="flex items-center gap-2 text-[12px] text-red-400">
          <AlertCircle size={14} />
          {model.error}
        </div>
      )}

      {/* Status + Actions */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-border">
        <div className="flex items-center gap-2">
          {model.downloaded ? (
            <>
              <Check size={14} className="text-green-400" />
              <span className="text-[13px] text-green-400 font-medium">Downloaded</span>
            </>
          ) : model.downloading ? (
            <>
              <Loader2 size={14} className="text-accent animate-spin" />
              <span className="text-[13px] text-accent font-medium">Downloading</span>
            </>
          ) : (
            <>
              <div className="w-3.5 h-3.5 rounded-full border border-text-muted" />
              <span className="text-[13px] text-text-muted">Not downloaded</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {model.downloaded ? (
            confirmDelete ? (
              <>
                <button
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-button text-[12px] font-medium bg-red-900/30 border border-red-500/30 text-red-400 hover:bg-red-900/50 transition-colors"
                  onClick={() => { onDelete(); setConfirmDelete(false); }}
                >
                  Confirm Delete
                </button>
                <button
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-button text-[12px] font-medium bg-app-surface border border-border text-text-secondary hover:bg-app-hover transition-colors"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-button text-[12px] font-medium bg-app-surface border border-border text-text-secondary hover:bg-app-hover transition-colors"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={12} />
                Delete
              </button>
            )
          ) : !model.downloading ? (
            <button
              className="inline-flex items-center gap-1.5 h-8 px-4 rounded-button text-[12px] font-medium bg-accent text-white hover:bg-accent-warm transition-colors shadow-accent-button"
              onClick={onDownload}
            >
              <Download size={12} />
              Download
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ModelsPage() {
  const { models, loading, globalError, refreshModels, downloadModel, deleteModel } = useModels();
  const [filter, setFilter] = useState<"all" | "downloaded" | "available">("all");

  const downloadedCount = models.filter((m) => m.downloaded).length;
  const totalSize = models.filter((m) => m.downloaded).reduce((s, m) => s + m.sizeBytes, 0);

  const filteredModels = models.filter((m) => {
    if (filter === "downloaded") return m.downloaded;
    if (filter === "available") return !m.downloaded;
    return true;
  });

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold text-text-primary leading-tight">Models</h1>
          <p className="text-[13px] text-text-muted mt-1">
            Manage speech recognition models. Download, check status, or remove models you no longer need.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 h-9 px-4 rounded-button text-[13px] font-medium bg-app-surface border border-border text-text-primary hover:bg-app-hover transition-colors"
          onClick={() => void refreshModels()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 mb-6 px-5 py-3 bg-app-surface rounded-card border border-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-[13px] text-text-secondary">
            <strong className="text-text-primary">{downloadedCount}</strong> of {MODEL_CATALOG.length} downloaded
          </span>
        </div>
        <div className="h-4 w-px bg-border-hover" />
        <div className="text-[13px] text-text-secondary">
          Total size: <strong className="text-text-primary">{formatBytes(totalSize)}</strong>
        </div>
        <div className="h-4 w-px bg-border-hover" />
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-text-muted">Requires at least 1 model to use STT</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-5">
        {([
          { key: "all" as const, label: "All Models" },
          { key: "downloaded" as const, label: "Downloaded" },
          { key: "available" as const, label: "Available" },
        ]).map(({ key, label }) => (
          <button
            key={key}
            className={cn(
              "h-8 px-4 rounded-badge text-[13px] font-medium transition-all duration-200",
              filter === key
                ? "bg-app-surface border border-accent text-text-primary"
                : "text-text-muted hover:text-text-secondary hover:bg-border",
            )}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "downloaded" && downloadedCount > 0 && (
              <span className="ml-1.5 text-[11px] text-accent">{downloadedCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {globalError && (
        <div className="flex items-center gap-3 mb-5 rounded-card bg-red-900/20 border border-red-500/30 px-4 py-3">
          <AlertCircle size={16} className="text-red-400 shrink-0" />
          <span className="text-[13px] text-red-400">{globalError}</span>
          <button
            className="ml-auto text-red-400 hover:text-red-300 text-lg leading-none transition-colors"
            onClick={() => {}}
          >
            ×
          </button>
        </div>
      )}

      {/* No models warning */}
      {downloadedCount === 0 && !loading && (
        <div className="flex items-center gap-3 mb-5 rounded-card bg-yellow-900/20 border border-yellow-500/30 px-4 py-3">
          <AlertCircle size={16} className="text-yellow-400 shrink-0" />
          <span className="text-[13px] text-yellow-400">
            No models downloaded yet. Download at least one model to start using speech-to-text.
          </span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-[14px] text-text-muted">
          <Loader2 size={18} className="animate-spin mr-2" />
          Checking model status...
        </div>
      )}

      {/* Model grid */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredModels.map((model) => {
            const info = getModelInfo(model.name);
            if (!info) return null;
            return (
              <ModelCard
                key={model.name}
                model={model}
                info={info}
                onDownload={() => void downloadModel(model.name)}
                onDelete={() => void deleteModel(model.name)}
              />
            );
          })}
        </div>
      )}

      {/* Empty state for filter */}
      {!loading && filteredModels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[14px] text-text-muted">
            {filter === "downloaded"
              ? "No models downloaded yet."
              : "All models are downloaded!"}
          </p>
        </div>
      )}
    </div>
  );
}
