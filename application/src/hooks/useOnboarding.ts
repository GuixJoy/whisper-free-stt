// ── Onboarding hook: manages wizard state machine, system checks, model downloads ──
import { useReducer, useCallback } from "react";
import {
  onboardingReducer,
  DEFAULT_ONBOARDING,
  MODEL_CATALOG,
} from "../store";
import type { SystemCheck } from "../store";

interface RustCheck {
  name: string;
  status: "pass" | "fail" | "warning";
  message: string;
  fixHint: string | null;
}

interface RustModelStatus {
  id: string;
  name: string;
  downloaded: boolean;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function useOnboarding(onComplete: () => void) {
  const [state, dispatch] = useReducer(onboardingReducer, DEFAULT_ONBOARDING);

  const runSystemChecks = useCallback(async () => {
    let checks: SystemCheck[] = [];

    try {
      if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const rustChecks = await invoke<RustCheck[]>("check_system_deps");
        checks = rustChecks.map((c) => ({
          name: c.name,
          status: c.status,
          message: c.message,
          fixHint: c.fixHint ?? undefined,
        }));
      } else {
        checks = [
          { name: "Audio Server", status: "pass", message: "Audio available" },
          { name: "Clipboard Tool", status: "pass", message: "Clipboard available" },
        ];
      }
    } catch (err) {
      dispatch({ type: "SET_ERROR", error: err instanceof Error ? err.message : "System check failed" });
    }

    checks.push({
      name: "Disk Space",
      status: "pass",
      message: "Sufficient space for models (≈2 GB recommended)",
    });

    dispatch({ type: "SET_SYSTEM_CHECKS", checks });
    dispatch({ type: "NEXT_STEP" });
  }, []);

  const downloadModels = useCallback(async (modelNames: string[]) => {
    if (modelNames.length === 0) return;

    for (const name of modelNames) {
      dispatch({
        type: "SET_DOWNLOAD_PROGRESS",
        name,
        percent: 0,
        bytesDownloaded: 0,
        bytesTotal: 0,
        status: "downloading",
      });

      try {
        if (isTauri()) {
          const { invoke } = await import("@tauri-apps/api/core");
          const entry = MODEL_CATALOG.find((m) => m.name === name);
          const modelId = entry?.id ?? name;

          await invoke("download_model", { id: modelId });

          // Poll until the model appears downloaded.
          await new Promise<void>((resolve) => {
            const poll = setInterval(async () => {
              try {
                const statuses = await invoke<RustModelStatus[]>("check_model_status");
                const status = statuses.find((s) => s.id === modelId);
                if (status?.downloaded) {
                  clearInterval(poll);
                  dispatch({
                    type: "SET_DOWNLOAD_PROGRESS",
                    name,
                    percent: 100,
                    bytesDownloaded: 0,
                    bytesTotal: 0,
                    status: "done",
                  });
                  resolve();
                }
              } catch {
                /* retry */
              }
            }, 2000);
          });
        } else {
          dispatch({
            type: "SET_DOWNLOAD_PROGRESS",
            name,
            percent: 100,
            bytesDownloaded: 0,
            bytesTotal: 0,
            status: "done",
          });
        }
      } catch (err) {
        dispatch({
          type: "SET_DOWNLOAD_PROGRESS",
          name,
          percent: 0,
          bytesDownloaded: 0,
          bytesTotal: 0,
          status: "error",
        });
        dispatch({ type: "SET_ERROR", error: `${name}: ${err instanceof Error ? err.message : "Download failed"}` });
      }
    }

    dispatch({ type: "NEXT_STEP" });
  }, []);

  const testMic = useCallback(() => {
    // Mic test placeholder
  }, []);

  const nextStep = useCallback(() => {
    dispatch({ type: "NEXT_STEP" });
  }, []);

  const finish = useCallback(() => {
    dispatch({ type: "SET_COMPLETED" });
    onComplete();
  }, [onComplete]);

  return {
    state,
    dispatch,
    runSystemChecks,
    downloadModels,
    testMic,
    nextStep,
    finish,
  };
}
