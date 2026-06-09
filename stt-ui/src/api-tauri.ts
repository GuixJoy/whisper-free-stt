// ── Tauri sidecar: spawns `stt-engine` via shell plugin ──
import { type STTApi, type STTEvent } from "./api";
import type { Child } from "@tauri-apps/plugin-shell";

export function createTauriApi(args: string[], sidecarName: string = "binaries/stt-engine"): STTApi {
  let listeners: Array<(e: STTEvent) => void> = [];
  let child: Child | null = null;

  const notifyError = (msg: string) => {
    for (const cb of listeners) cb({ type: "error", message: msg });
  };

  const handleLine = (source: string, line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event: STTEvent = JSON.parse(trimmed);
      for (const cb of listeners) cb(event);
    } catch {
      if (source === "stderr") {
        console.warn(`[Sidecar stderr] ${trimmed}`);
      } else {
        console.log(`[Sidecar stdout] ${trimmed}`);
      }
    }
  };

  return {
    onEvent(cb) { listeners.push(cb); },

    async start() {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const cmd = Command.sidecar(sidecarName, args);
      cmd.stdout.on("data", (line: string) => handleLine("stdout", line));
      cmd.stderr.on("data", (line: string) => handleLine("stderr", line));
      cmd.on("close", () => {
        for (const cb of listeners) cb({ type: "state", state: "idle" });
      });
      cmd.on("error", (err: string) => {
        notifyError(`Sidecar error: ${err}`);
      });
      child = await cmd.spawn();
    },

    stop() {
      listeners = [];
      if (child) {
        try { child.kill(); } catch { }
        child = null;
      }
    },
  };
}

