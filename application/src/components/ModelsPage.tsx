import { useState } from "react";
import { cn } from "@/lib/utils";
import { useModels, formatBytes, getModelInfo, getLlmModelInfo } from "../hooks/useModels";
import { RefreshCw, Download, Trash2, Check, AlertCircle, Loader2 } from "lucide-react";

function ModelCard({
  model,
  info,
  onDownload,
  onDelete,
}: {
  model: {
    name: string;
    backend: string;
    downloaded: boolean;
    downloading: boolean;
    progress: number;
    error: string | null;
    sizeBytes: number;
  };
  info: { recommended: boolean; size: string; bestFor: string; speed?: string; accuracy?: string };
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-card border p-5 transition-colors duration-200",
        model.downloaded
          ? "border-[rgba(255,59,86,0.15)] bg-[rgba(255,227,229,0.25)]"
          : model.downloading
            ? "border-accent bg-app-surface-card"
            : "border-border bg-app-surface-card hover:border-border-hover",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <strong className="text-[15px] text-text-primary">{model.name}</strong>
          {info.recommended && (
            <span className="inline-flex items-center rounded-badge border border-accent-muted-border bg-accent-muted px-2 py-0.5 text-[11px] font-semibold text-accent-active">
              Recommended
            </span>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center rounded-badge px-2.5 py-0.5 text-[12px] font-semibold",
            model.backend === "faster_whisper"
              ? "border border-accent-muted-border bg-accent-muted text-accent-active"
              : "border border-border bg-app-surface text-text-secondary",
          )}
        >
          {model.backend === "faster_whisper" ? "GPU" : "CPU"}
        </span>
      </div>

      {/* Info row */}
      <div className="flex items-center gap-4 text-[13px] text-text-muted">
        <span className="tabular-nums">{info.size}</span>
        {info.speed && <span>{info.speed}</span>}
        {info.accuracy && <span>{info.accuracy}</span>}
        {model.downloaded && model.sizeBytes > 0 && (
          <span className="tabular-nums text-green-400">{formatBytes(model.sizeBytes)}</span>
        )}
      </div>
      <p className="text-[13px] text-text-secondary">{info.bestFor}</p>

      {/* Progress bar (downloading) */}
      {model.downloading && (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-app-surface-secondary">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-150"
              style={{ width: `${model.progress}%` }}
            />
          </div>
          <span className="text-[12px] tabular-nums text-text-secondary">
            {model.progress > 0 ? `${model.progress}%` : "Preparing download…"}
          </span>
        </div>
      )}

      {/* Error */}
      {model.error && (
        <div className="flex items-center gap-2 text-[12px] text-red-600">
          <AlertCircle size={14} />
          {model.error}
        </div>
      )}

      {/* Status + Actions */}
      <div className="mt-auto flex items-center justify-between border-t border-border pt-2">
        <div className="flex items-center gap-2">
          {model.downloaded ? (
            <>
              <Check size={14} className="text-green-400" />
              <span className="text-[13px] font-medium text-green-400">Downloaded</span>
            </>
          ) : model.downloading ? (
            <>
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="text-[13px] font-medium text-accent">Downloading</span>
            </>
          ) : (
            <>
              <div className="h-3.5 w-3.5 rounded-full border border-text-muted" />
              <span className="text-[13px] text-text-muted">Not downloaded</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {model.downloaded ? (
            confirmDelete ? (
              <>
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-button border border-red-500/20 bg-red-500/10 px-3 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-500/20"
                  onClick={() => {
                    onDelete();
                    setConfirmDelete(false);
                  }}
                >
                  Confirm Delete
                </button>
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-button border border-border bg-app-surface px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-app-hover"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-button border border-border bg-app-surface px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-app-hover"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={12} />
                Delete
              </button>
            )
          ) : !model.downloading ? (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-button bg-accent px-4 text-[12px] font-medium text-white shadow-accent-button transition-colors hover:bg-accent-warm"
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

  const asrModels = models.filter((m) => m.section === "asr");
  const llmModels = models.filter((m) => m.section === "llm");

  const downloadedCount = models.filter((m) => m.downloaded).length;
  const downloadedAsrCount = asrModels.filter((m) => m.downloaded).length;
  const totalCount = models.length;
  const totalSize = models.filter((m) => m.downloaded).reduce((s, m) => s + m.sizeBytes, 0);

  const filteredAsr = asrModels.filter((m) => {
    if (filter === "downloaded") return m.downloaded;
    if (filter === "available") return !m.downloaded;
    return true;
  });

  const filteredLlm = llmModels.filter((m) => {
    if (filter === "downloaded") return m.downloaded;
    if (filter === "available") return !m.downloaded;
    return true;
  });

  return (
    <div className="flex flex-1 flex-col overflow-auto p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-balance text-[24px] font-semibold leading-tight text-text-primary">
            Models
          </h2>
          <p className="mt-1 text-[13px] text-text-muted">
            Manage speech recognition models. Download, check status, or remove models you no longer
            need.
          </p>
        </div>
        <button
          className="inline-flex h-9 items-center gap-2 rounded-button border border-border bg-app-surface px-4 text-[13px] font-medium text-text-primary transition-colors hover:bg-app-hover"
          onClick={() => void refreshModels()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats bar */}
      <div className="mb-6 flex items-center gap-6 rounded-card border border-border bg-app-surface px-5 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-400" />
          <span className="text-[13px] text-text-secondary">
            <strong className="text-text-primary">{downloadedCount}</strong> of {totalCount}{" "}
            downloaded
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
      <div className="mb-5 flex items-center gap-1">
        {[
          { key: "all" as const, label: "All Models" },
          { key: "downloaded" as const, label: "Downloaded" },
          { key: "available" as const, label: "Available" },
        ].map(({ key, label }) => (
          <button
            key={key}
            className={cn(
              "h-8 rounded-badge px-4 text-[13px] font-medium transition-colors duration-200",
              filter === key
                ? "border border-[rgba(255,59,86,0.15)] bg-accent-surface text-accent"
                : "text-text-muted hover:bg-accent-hover-surface hover:text-text-secondary",
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
        <div className="mb-5 flex items-center gap-3 rounded-card border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertCircle size={16} className="shrink-0 text-red-600" />
          <span className="text-[13px] text-red-600">{globalError}</span>
        </div>
      )}

      {/* No models warning */}
      {downloadedAsrCount === 0 && !loading && (
        <div className="mb-5 flex items-center gap-3 rounded-card border border-yellow-500/25 bg-yellow-500/10 px-4 py-3">
          <AlertCircle size={16} className="shrink-0 text-yellow-700" />
          <span className="text-[13px] text-yellow-700">
            No speech-recognition models downloaded yet. Download at least one model to start using
            speech-to-text.
          </span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-[14px] text-text-muted">
          <Loader2 size={18} className="mr-2 animate-spin" />
          Checking model status…
        </div>
      )}

      {/* Model grid */}
      {!loading && (
        <div className="flex flex-col gap-6">
          {/* ASR Models */}
          {filteredAsr.length > 0 && (
            <div>
              <h2 className="mb-3 text-balance text-[14px] font-medium text-text-primary">
                Speech Recognition
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {filteredAsr.map((model) => {
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
            </div>
          )}

          {/* LLM Models */}
          {filteredLlm.length > 0 && (
            <div>
              <h2 className="mb-3 text-balance text-[14px] font-medium text-text-primary">
                Text Cleanup (LLM)
              </h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {filteredLlm.map((model) => {
                  const info = getLlmModelInfo(model.name);
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
            </div>
          )}
        </div>
      )}

      {/* Empty state for filter */}
      {!loading && filteredAsr.length === 0 && filteredLlm.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[14px] text-text-muted">
            {filter === "downloaded" ? "No models downloaded yet." : "All models are downloaded!"}
          </p>
        </div>
      )}
    </div>
  );
}
