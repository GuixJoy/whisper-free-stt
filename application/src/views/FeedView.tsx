// ── Live transcription feed ──
//
// Extracted from App.tsx (which held it alongside the engine lifecycle, tray
// and widget wiring). Presentational plus the mic-permission branch for the
// mic button; recording itself is owned by App and passed in via `start`/`stop`.

import { useEffect, useMemo, useRef, useState } from "react";
import { Mic } from "lucide-react";
import MicButton from "../components/MicButton";
import ModelBadge from "../components/ModelBadge";
import ErrorBanner from "../components/ErrorBanner";
import type { AppError } from "../components/ErrorBanner";
import Waveform from "../components/Waveform";
import { micLevelEmitter } from "../utils/mic-emitter";
import { isTauri, formatTimestamp } from "../lib/utils";
import { type RuntimeSettings } from "../lib/settings";

export interface TranscriptLine {
  id: number;
  raw: string;
  processed: string;
  status: string;
  createdAt: string;
}

function LiveFeedMicMeter() {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return micLevelEmitter.subscribe((level) => {
      if (fillRef.current) {
        fillRef.current.style.width = `${Math.min(100, level * 220)}%`;
      }
    });
  }, []);

  return (
    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-app-surface-secondary">
      <div
        ref={fillRef}
        className="h-full rounded-full bg-accent transition-[width] duration-75"
        style={{ width: "0%" }}
      />
    </div>
  );
}

function SessionStats({ lines }: { lines: TranscriptLine[] }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const totalWords = lines.reduce((sum, l) => {
    const text = l.processed || l.raw;
    return sum + (text ? text.split(/\s+/).filter(Boolean).length : 0);
  }, 0);

  const minutes = Math.max(elapsed / 60000, 0.01);
  const wpm = Math.round(totalWords / minutes);

  return (
    <>
      <span>{wpm} WPM</span>
      <span>{totalWords} words</span>
      <span>{Math.round(elapsed / 60000)}m</span>
    </>
  );
}

export function FeedView({
  connected,
  status,
  lines,
  historyItems,
  historyLoading,
  hasMoreHistory,
  onFeedScroll,
  start,
  stop,
  copyLatest,
  copyLine,
  clearLines,
  feedRef,
  errors,
  showErrors,
  setShowErrors,
  dismissError,
  onRequestMicPermission,
  asrProfile,
  resolvedModel,
}: {
  connected: boolean;
  status: string;
  lines: TranscriptLine[];
  historyItems: TranscriptLine[];
  historyLoading: boolean;
  hasMoreHistory: boolean;
  onFeedScroll: () => void;
  start: (overrideSettings?: RuntimeSettings, source?: string) => void;
  stop: () => void;
  copyLatest: () => void;
  copyLine: (line: TranscriptLine) => void;
  clearLines: () => void;
  feedRef: React.RefObject<HTMLDivElement | null>;
  errors: AppError[];
  showErrors: boolean;
  setShowErrors: (v: boolean | ((s: boolean) => boolean)) => void;
  dismissError: (id: string) => void;
  onRequestMicPermission: () => void;
  asrProfile: string;
  resolvedModel: { profile: string; model: string; backend: string; device: string } | null;
}) {
  const handleToggle = () => {
    if (connected) {
      stop();
    } else {
      if (isTauri()) {
        // Tauri handles mic natively via OS — skip browser Permissions API check
        // (WebKitGTK on Linux doesn't support navigator.permissions for microphone)
        start(undefined, "MicButton");
      } else if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: "microphone" as PermissionName })
          .then((status) => {
            if (status.state === "granted") {
              start(undefined, "MicButton");
            } else {
              onRequestMicPermission();
            }
          })
          .catch(() => {
            start(undefined, "MicButton");
          });
      } else {
        start(undefined, "MicButton");
      }
    }
  };

  const statusLabel = (() => {
    switch (status) {
      case "listening":
        return "Listening";
      case "transcribing":
        return "Transcribing";
      case "rewriting":
        return "Rewriting";
      case "error":
        return "Error";
      default:
        return "Idle";
    }
  })();

  // Global model-download progress (pipeline lazy-downloads + Models page).
  // A persistent pill under the model badge — the download outlives toasts.
  const [download, setDownload] = useState<{ id: string; percent: number } | null>(null);
  useEffect(() => {
    const unlistenFns: Array<() => void> = [];
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenFns.push(
          await listen<{ id: string; percent: number; done?: boolean }>(
            "model_download_progress",
            (event) => {
              if (event.payload.done) setDownload(null);
              else setDownload({ id: event.payload.id, percent: event.payload.percent });
            },
          ),
          await listen("model_download_error", () => setDownload(null)),
        );
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      unlistenFns.forEach((un) => un());
    };
  }, []);

  // ponytail: O(n) memo + 100-row render cap instead of virtualized list;
  // upgrade to react-window/virtualizer when feed routinely exceeds ~500 rows.
  const reversedLines = useMemo(() => [...lines].reverse().slice(0, 100), [lines]);
  const visibleHistory = useMemo(() => {
    const liveTexts = new Set(lines.map((l) => l.processed || l.raw));
    const liveTimes = lines.map((l) => new Date(l.createdAt).getTime());
    return historyItems
      .filter((item) => {
        const text = item.processed || item.raw;
        if (!liveTexts.has(text)) return true;
        const t = new Date(item.createdAt + (item.createdAt.includes("Z") ? "" : "Z")).getTime();
        return !liveTimes.some((lt) => Math.abs(lt - t) < 5000);
      })
      .slice(0, 100);
  }, [lines, historyItems]);

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col overflow-hidden p-6">
        {/* Centered mic area */}
        <div className="mb-4 flex flex-col items-center gap-3">
          <MicButton status={status} connected={connected} onToggle={handleToggle} />
          <p className="text-[13px] text-text-muted" role="status" aria-live="polite">
            {statusLabel} &middot; {lines.length} lines
          </p>
          <ModelBadge profile={asrProfile} resolvedModel={resolvedModel} />
          {download && (
            <div
              className="flex items-center gap-2 rounded-full border border-[rgba(44,37,32,0.06)] bg-white/60 px-3 py-1.5"
              role="status"
              aria-label={`Downloading ${download.id}`}
            >
              <span className="text-[11px] font-medium text-text-muted">
                Downloading {download.id}… {download.percent}%
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-app-surface-secondary">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${Math.min(100, download.percent)}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-[36px] items-center gap-2 rounded-[12px] px-4 text-[13px] font-medium text-text-muted transition-colors hover:bg-border hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
              onClick={() => void copyLatest()}
              disabled={lines.length === 0}
            >
              Copy
            </button>
            <button
              className="inline-flex h-[36px] items-center gap-2 rounded-[12px] px-4 text-[13px] font-medium text-text-muted transition-colors hover:bg-border hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
              onClick={clearLines}
              disabled={lines.length === 0}
            >
              Clear
            </button>
            {errors.filter((e) => !e.dismissed).length > 0 && (
              <button
                className="inline-flex h-[36px] items-center gap-2 rounded-[12px] px-4 text-[13px] font-medium text-text-muted transition-colors hover:bg-border hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                onClick={() => setShowErrors((s) => !s)}
              >
                Errors ({errors.filter((e) => !e.dismissed).length})
              </button>
            )}
          </div>
        </div>

        {/* Feed */}
        <div
          className="flex flex-1 flex-col overflow-hidden rounded-[28px] border"
          style={{ backgroundColor: "rgba(255,255,255,0.45)", borderColor: "rgba(44,37,32,0.06)" }}
        >
          {/* Feed Header */}
          <div
            className="flex items-center gap-3 px-4 py-2.5"
            style={{ borderBottom: "1px solid rgba(44,37,32,0.08)" }}
          >
            <LiveFeedMicMeter />
            {connected && <Waveform width={120} height={24} barCount={16} />}
            <div className="flex items-center gap-2 text-[12px]">
              <span
                className="inline-flex items-center gap-1.5"
                role="status"
                aria-label={connected ? "Live" : "Idle"}
              >
                <span
                  aria-hidden="true"
                  className={
                    connected
                      ? "h-2 w-2 rounded-full bg-success"
                      : "h-2 w-2 rounded-full border border-text-muted bg-transparent"
                  }
                />
                <span className={connected ? "font-medium text-success" : "text-text-muted"}>
                  {connected ? "Live" : "Idle"}
                </span>
              </span>
              <span className="tabular-nums text-text-muted">
                {lines.length + historyItems.length}&nbsp;lines
              </span>
            </div>
            {connected && (
              <div className="ml-auto flex items-center gap-4 text-[12px] text-text-muted">
                <SessionStats lines={lines} />
              </div>
            )}
          </div>

          {/* Transcript Lines */}
          <div
            className="flex-1 overflow-auto"
            ref={feedRef}
            onScroll={onFeedScroll}
            role="log"
            aria-live="polite"
            aria-label="Transcription feed"
          >
            {lines.length === 0 && historyItems.length === 0 && !historyLoading ? (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <Mic size={72} strokeWidth={1} className="mb-4 text-accent/40" aria-hidden="true" />
                <p className="mb-1 text-[15px] text-text-primary">
                  Start speaking to begin transcription
                </p>
                <p className="text-[13px] text-text-muted">
                  Press{" "}
                  <kbd className="rounded border border-border-hover bg-border px-1.5 py-0.5 text-[11px] text-text-muted">
                    Space
                  </kbd>{" "}
                  to start or stop
                </p>
              </div>
            ) : (
              <>
                {reversedLines.map((line) => (
                  <div
                    key={`live-${line.id}`}
                    className="group flex items-center justify-between px-4 transition-colors hover:bg-border"
                    style={{ paddingTop: "16px", paddingBottom: "16px" }}
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-3">
                      <span className="w-[80px] shrink-0 text-[13px] text-text-muted">
                        {new Date(line.createdAt).toLocaleTimeString()}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[16px] leading-[1.7] text-text-primary">
                        {line.processed || line.raw}
                      </span>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <button
                        className="rounded px-1 text-[14px] text-text-muted transition-colors hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                        onClick={() => void copyLine(line)}
                        aria-label={`Copy line: ${(line.processed || line.raw).slice(0, 60)}`}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ))}
                {visibleHistory.map((item) => (
                  <div
                    key={`hist-${item.id}`}
                    className="group flex items-center justify-between border-t border-border px-4 transition-colors hover:bg-border"
                    style={{ paddingTop: "16px", paddingBottom: "16px" }}
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-3">
                      <span className="w-[140px] shrink-0 text-[13px] text-text-muted">
                        {formatTimestamp(item.createdAt)}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[16px] leading-[1.7] text-text-primary/70">
                        {item.processed || item.raw}
                      </span>
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <button
                        className="rounded px-1 text-[14px] text-text-muted transition-colors hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                        onClick={() => void copyLine(item)}
                        aria-label={`Copy line: ${(item.processed || item.raw).slice(0, 60)}`}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ))}
                {historyLoading && (
                  <div
                    className="flex flex-col gap-2 px-4 py-4"
                    role="status"
                    aria-label="Loading history"
                  >
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="flex animate-pulse items-baseline gap-3"
                        aria-hidden="true"
                      >
                        <div className="h-3 w-[80px] shrink-0 rounded bg-app-surface-secondary" />
                        <div className="h-4 flex-1 rounded bg-app-surface-secondary" />
                      </div>
                    ))}
                    <span className="sr-only">Loading history…</span>
                  </div>
                )}
                {!hasMoreHistory && historyItems.length > 0 && (
                  <div className="flex items-center justify-center py-6 text-[13px] text-text-muted">
                    No more history
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <ErrorBanner
        visible={showErrors}
        onClose={() => setShowErrors(false)}
        errors={errors}
        onDismiss={dismissError}
        onRetry={(id) => {
          dismissError(id);
          start(undefined, "ErrorRetry");
        }}
      />
    </div>
  );
}
