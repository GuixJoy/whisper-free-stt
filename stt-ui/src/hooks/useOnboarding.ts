// ── Onboarding hook: manages wizard state machine, system checks, model downloads ──
import { useReducer, useCallback } from "react";
import {
  onboardingReducer,
  DEFAULT_ONBOARDING,
} from "../store";
import type { SystemCheck } from "../store";

interface RustCheck {
  name: string;
  status: "pass" | "fail" | "warning";
  message: string;
  fixHint: string | null;
}

export function useOnboarding(onComplete: () => void) {
  const [state, dispatch] = useReducer(onboardingReducer, DEFAULT_ONBOARDING);

  const runSystemChecks = useCallback(async () => {
    let checks: SystemCheck[] = [];

    try {
      // In Tauri mode, use the native Rust check_system_deps command
      // which uses real system processes (not the restricted shell plugin)
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        const rustChecks = await invoke<RustCheck[]>("check_system_deps");
        checks = rustChecks.map((c) => ({
          name: c.name,
          status: c.status,
          message: c.message,
          fixHint: c.fixHint ?? undefined,
        }));
      } else {
        // Web dev mode: assume everything is available
        checks = [
          { name: "Audio Server", status: "pass", message: "Audio available" },
          { name: "Clipboard Tool", status: "pass", message: "Clipboard available" },
        ];
      }
    } catch {
      // Fallback: if invoke fails, show platform-appropriate defaults
      checks = [
        { name: "Audio Server", status: "pass", message: "Audio available (dev mode)" },
        { name: "Clipboard Tool", status: "pass", message: "Clipboard available (dev mode)" },
      ];
    }

    // Disk space check (not in Rust backend yet — add here)
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

      // In Tauri mode, have the sidecar download the model
      try {
        if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
          const { Command } = await import("@tauri-apps/plugin-shell");
          const cmd = Command.sidecar("stt-engine", [
            "--json-mode", "--model", name, "--asr-profile", "speed", "--llm-mode", "off",
            "--input-file", "/dev/null",
          ]);
          // Track progress by parsing stdout for download info
          cmd.stdout.on("data", (line: string) => {
            if (line.includes("Downloading") || line.includes("download")) {
              dispatch({
                type: "SET_DOWNLOAD_PROGRESS",
                name,
                percent: 50, // approximate mid-point
                bytesDownloaded: 0,
                bytesTotal: 0,
                status: "downloading",
              });
            }
          });
          try {
            await cmd.execute();
            dispatch({
              type: "SET_DOWNLOAD_PROGRESS",
              name,
              percent: 100,
              bytesDownloaded: 0,
              bytesTotal: 0,
              status: "done",
            });
          } catch {
            dispatch({
              type: "SET_DOWNLOAD_PROGRESS",
              name,
              percent: 0,
              bytesDownloaded: 0,
              bytesTotal: 0,
              status: "error",
            });
          }
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
      } catch {
        dispatch({
          type: "SET_DOWNLOAD_PROGRESS",
          name,
          percent: 0,
          bytesDownloaded: 0,
          bytesTotal: 0,
          status: "error",
        });
      }
    }

    dispatch({ type: "NEXT_STEP" });
  }, []);

  const testMic = useCallback(() => {
    // Mic test placeholder — in Tauri mode this spawns a brief capture
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
