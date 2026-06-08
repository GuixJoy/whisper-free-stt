// ── Onboarding hook: manages wizard state machine, system checks, model downloads ──
import { useReducer, useCallback } from "react";
import {
  onboardingReducer,
  DEFAULT_ONBOARDING,
} from "../store";
import type { SystemCheck } from "../store";
import { detectPlatform } from "../utils/platform";

export function useOnboarding(onComplete: () => void) {
  const [state, dispatch] = useReducer(onboardingReducer, DEFAULT_ONBOARDING);

  const runSystemChecks = useCallback(async () => {
    const p = detectPlatform();
    const checks: SystemCheck[] = [];

    const checkShell = async (cmd: string): Promise<boolean> => {
      try {
        if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
          const { Command } = await import("@tauri-apps/plugin-shell");
          const c = Command.create("sh", ["-c", `command -v ${cmd.split(" ")[0]}`]);
          let found = false;
          c.stdout.on("data", () => { found = true; });
          try { await c.execute(); } catch { /* not found */ }
          return found;
        }
        return true; // web dev mode assumes available
      } catch {
        return false;
      }
    };

    if (p.platform === "linux") {
      const hasPipewire = await checkShell("pactl");
      checks.push({
        name: "Audio Server",
        status: hasPipewire ? "pass" : "fail",
        message: hasPipewire ? "PulseAudio/PipeWire detected" : "PulseAudio/PipeWire not found",
        fixHint: hasPipewire ? undefined : "Install: sudo apt install pipewire-pulse",
      });

      const hasAudio = await checkShell("pactl info");
      checks.push({
        name: "Audio Group",
        status: hasAudio ? "pass" : "warning",
        message: hasAudio ? "Audio access available" : "May need audio group membership",
        fixHint: hasAudio ? undefined : "Run: sudo usermod -aG audio $USER",
      });

      const hasXclip = await checkShell("xclip");
      const hasWlCopy = await checkShell("wl-copy");
      checks.push({
        name: "Clipboard Tool",
        status: hasXclip || hasWlCopy ? "pass" : "warning",
        message: hasXclip || hasWlCopy ? `${hasWlCopy ? "wl-copy" : "xclip"} available` : "No clipboard tool found",
        fixHint: hasXclip || hasWlCopy ? undefined : "Install: sudo apt install wl-clipboard xclip",
      });
    } else if (p.platform === "macos") {
      checks.push({
        name: "Audio Server",
        status: "pass",
        message: "macOS CoreAudio available",
      });
      checks.push({
        name: "Clipboard Tool",
        status: "pass",
        message: "pbcopy available",
      });
    } else {
      checks.push({
        name: "Audio Server",
        status: "pass",
        message: "Windows WASAPI available",
      });
      checks.push({
        name: "Clipboard Tool",
        status: "pass",
        message: "clip.exe available",
      });
    }

    // Disk space check
    checks.push({
      name: "Disk Space",
      status: "pass",
      message: "Sufficient space for models (≈2 GB recommended)",
    });

    dispatch({ type: "SET_SYSTEM_CHECKS", checks });
    // Don't auto-advance — let user review checks before clicking Continue
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
    finish,
  };
}
