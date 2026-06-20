// ── Model management hook: check status, download, track progress ──
import { useState, useCallback, useEffect, useRef } from "react";
import { MODEL_CATALOG } from "../store";
import type { ModelInfo } from "../store";

export interface ModelStatusEntry {
  name: string;
  backend: "whisper_cpp" | "faster_whisper";
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  error: string | null;
  sizeBytes: number;
  path: string;
}

interface RustModelStatus {
  name: string;
  downloaded: boolean;
  path: string;
  size_bytes: number;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useModels() {
  const [models, setModels] = useState<ModelStatusEntry[]>(() =>
    MODEL_CATALOG.map((m) => ({
      name: m.name,
      backend: m.backend,
      downloaded: false,
      downloading: false,
      progress: 0,
      error: null,
      sizeBytes: 0,
      path: "",
    }))
  );
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          // Match by name across both whisper_cpp and faster_whisper entries
          const status = rustStatuses.find((s) => s.name === m.name);
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

  const downloadModel = useCallback(async (modelName: string) => {
    if (!isTauri()) {
      setGlobalError("Model download is only available in the desktop app");
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
      const { Command } = await import("@tauri-apps/plugin-shell");
      const cmd = Command.sidecar("binaries/stt-engine", [
        "--json-mode",
        "--model", modelName,
        "--asr-profile", "speed",
        "--llm-mode", "off",
        "--input-file", "/dev/null",
      ]);

      let lastProgress = 0;
      cmd.stdout.on("data", (line: string) => {
        // Parse download progress from stdout
        const downloadMatch = line.match(/Downloading.*?(\d+)%/i) || line.match(/(\d+)%/);
        if (downloadMatch) {
          lastProgress = parseInt(downloadMatch[1], 10);
          setModels((prev) =>
            prev.map((m) =>
              m.name === modelName
                ? { ...m, progress: lastProgress }
                : m
            )
          );
        }
      });

      await cmd.execute();

      // Mark as done and refresh actual disk status
      setModels((prev) =>
        prev.map((m) =>
          m.name === modelName
            ? { ...m, downloading: false, progress: 100 }
            : m
        )
      );
      await refreshModels();
    } catch (err) {
      setModels((prev) =>
        prev.map((m) =>
          m.name === modelName
            ? { ...m, downloading: false, progress: 0, error: err instanceof Error ? err.message : "Download failed" }
            : m
        )
      );
    }
  }, [refreshModels]);

  const deleteModel = useCallback(async (modelName: string) => {
    if (!isTauri()) return;

    const model = models.find((m) => m.name === modelName);
    if (!model || !model.downloaded || !model.path) return;

    try {
      const { Command } = await import("@tauri-apps/plugin-shell");
      await Command.sidecar("binaries/stt-engine", [
        "--json-mode",
        "--delete-model", modelName,
        "--llm-mode", "off",
        "--input-file", "/dev/null",
      ]).execute();
      await refreshModels();
    } catch {
      // Fallback: try direct removal via Rust
      try {
        const { invoke: invokeCmd } = await import("@tauri-apps/api/core");
        await invokeCmd("delete_model_file", { path: model.path });
        await refreshModels();
      } catch {
        setGlobalError(`Failed to delete ${modelName}`);
      }
    }
  }, [models, refreshModels]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
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

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}
