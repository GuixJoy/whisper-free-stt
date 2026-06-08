// ── Tauri sidecar: spawns `stt-engine` via shell plugin ──
import { type STTApi, type STTEvent } from "./api";
import type { Child } from "@tauri-apps/plugin-shell";

export function createTauriApi(args: string[], sidecarName: string = "stt-engine"): STTApi {
  let listeners: Array<(e: STTEvent) => void> = [];
  let child: Child | null = null;

  const notifyError = (msg: string) => {
    for (const cb of listeners) cb({ type: "error", message: msg });
  };

  return {
    onEvent(cb) { listeners.push(cb); },

    async start() {
      const { Command } = await import("@tauri-apps/plugin-shell");
      const cmd = Command.sidecar(sidecarName, args);
      cmd.stdout.on("data", (line: string) => {
        try {
          const event: STTEvent = JSON.parse(line);
          for (const cb of listeners) cb(event);
        } catch { /* partial line, ignore */ }
      });
      cmd.stderr.on("data", (line: string) => {
        notifyError(`stt-engine: ${line.trim()}`);
      });
      cmd.on("close", () => {
        for (const cb of listeners) cb({ type: "state", state: "idle" });
      });
      cmd.on("error", (err: string) => {
        notifyError(`Sidecar error: ${err}`);
      });
      child = await cmd.spawn();
    },

    stop() {
      if (child) {
        try { child.kill(); } catch { /* process already dead */ }
        child = null;
      }
    },
  };
}
