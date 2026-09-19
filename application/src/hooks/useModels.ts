// ── Model management hook: check status, download, track progress ──
import { useState, useCallback, useEffect, useRef } from "react";
import { MODEL_CATALOG, LLM_MODEL_CATALOG } from "../store";
import type { ASRBackend, ModelInfo, LlmModelInfo } from "../store";
import { isTauri } from "../lib/utils";

export interface ModelStatusEntry {
  name: string;
  id: string;
  backend: ASRBackend | "whisper_cpp" | "faster_whisper" | LlmModelInfo["backend"];
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
  sizeBytes: number;
  path: string;
  section: "asr" | "llm";
}

interface RustModelStatus {
  id: string;
  name: string;
  downloaded: boolean;
  path: string;
  size_bytes: number;
}

function buildInitialModels(): ModelStatusEntry[] {
  const asr = MODEL_CATALOG.map((m) => ({
    name: m.name,
    id: m.id,
    backend: m.backend,
    downloaded: false,
    downloading: false,
    progress: 0,
    error: null,
    sizeBytes: 0,
    path: "",
    section: "asr" as const,
  }));
  const llm = LLM_MODEL_CATALOG.map((m) => ({
    name: m.name,
    id: m.id,
    backend: m.backend,
    downloaded: false,
    downloading: false,
    progress: 0,
    error: null,
    sizeBytes: 0,
    path: "",
    section: "llm" as const,
  }));
  return [...asr, ...llm];
}

export function useModels() {
  const [models, setModels] = useState<ModelStatusEntry[]>(buildInitialModels);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const pollingRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const refreshModels = useCallback(async () => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const rustStatuses = await invoke<RustModelStatus[]>("check_model_status");

      setModels((prev) =>
        prev.map((m) => {
          // Match by name first, fall back to id (backend uses id for LLM models)
          const status =
            rustStatuses.find((s) => s.name === m.name) ??
            rustStatuses.find((s) => s.id === m.id);
          if (status) {
            return {
              ...m,
              downloaded: status.downloaded,
              sizeBytes: status.size_bytes,
              path: status.path,
            };
          }
          return m;
        })
      );
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : "Failed to check model status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  // Live backend download progress (lib.rs emits model_download_progress /
  // model_download_error). Falls back to status polling when events are
  // unavailable (e.g. browser dev mode).
  useEffect(() => {
    if (!isTauri()) return;
    const unlistenFns: Array<() => void> = [];
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenFns.push(
          await listen<{ id: string; percent: number; done?: boolean }>(
            "model_download_progress",
            (event) => {
              const { id, percent, done } = event.payload;
              setModels((prev) =>
                prev.map((m) =>
                  m.id === id
                    ? { ...m, downloading: !done, progress: done ? 100 : percent, error: null }
                    : m
                )
              );
              if (done) void refreshModels();
            }
          ),
          await listen<{ id: string; error: string }>("model_download_error", (event) => {
            const { id, error } = event.payload;
            setModels((prev) =>
              prev.map((m) =>
                m.id === id ? { ...m, downloading: false, error } : m
              )
            );
          })
        );
      } catch {
        /* not in Tauri; polling covers status */
      }
    })();
    return () => {
      unlistenFns.forEach((un) => un());
    };
  }, [refreshModels]);

  const downloadModel = useCallback(async (modelName: string) => {
    if (!isTauri()) {
      setGlobalError("Model download is only available in the desktop app");
      return;
    }

    const entry = models.find((m) => m.name === modelName);
    if (!entry) {
      setGlobalError(`Model "${modelName}" not found in catalog`);
      return;
    }

    setModels((prev) =>
      prev.map((m) =>
        m.name === modelName
          ? { ...m, downloading: true, progress: 0, error: null }
          : m
      )
    );

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("download_model", { id: entry.id });

      // Poll check_model_status until the model appears downloaded.
      const poll = setInterval(async () => {
        try {
          const statuses = await invoke<RustModelStatus[]>("check_model_status");
          const status =
            statuses.find((s) => s.name === modelName) ??
            statuses.find((s) => s.id === entry.id);
          if (status?.downloaded) {
            clearInterval(poll);
            pollingRef.current.delete(entry.id);
            setModels((prev) =>
              prev.map((m) =>
                m.name === modelName
                  ? { ...m, downloading: false, progress: 100 }
                  : m
              )
            );
            await refreshModels();
          }
        } catch {
          /* retry next tick */
        }
      }, 2000);

      pollingRef.current.set(entry.id, poll);
    } catch (err) {
      setModels((prev) =>
        prev.map((m) =>
          m.name === modelName
            ? { ...m, downloading: false, progress: 0, error: err instanceof Error ? err.message : "Download failed" }
            : m
        )
      );
    }
  }, [models, refreshModels]);

  const deleteModel = useCallback(async (modelName: string) => {
    if (!isTauri()) return;

    const model = models.find((m) => m.name === modelName);
    if (!model || !model.downloaded || !model.path) return;

    try {
      const { invoke: invokeCmd } = await import("@tauri-apps/api/core");
      await invokeCmd("delete_model_file", { path: model.path });
      await refreshModels();
    } catch {
      setGlobalError(`Failed to delete ${modelName}`);
    }
  }, [models, refreshModels]);

  // Cleanup polling on unmount
  useEffect(() => {
    // Capture the live map: intervals added later are visible through it,
    // and the linter is satisfied by not touching .current in cleanup.
    const timers = pollingRef.current;
    return () => {
      timers.forEach((timer) => clearInterval(timer));
      timers.clear();
    };
  }, []);

  return {
    models,
    loading,
    globalError,
    refreshModels,
    downloadModel,
    deleteModel,
  };
}

export function getModelInfo(modelName: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.name === modelName);
}

export function getLlmModelInfo(modelName: string): LlmModelInfo | undefined {
  return LLM_MODEL_CATALOG.find((m) => m.name === modelName);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}
