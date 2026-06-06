// ── Tauri sidecar: spawns `stt --json-mode` via shell plugin ──
import { type STTApi, type STTEvent } from "./api";

export function createTauriApi(args: string[]): STTApi {
  let listeners: Array<(e: STTEvent) => void> = [];
  let child: any = null;

  return {
    onEvent(cb) { listeners.push(cb); },

    async start() {
      try {
        // Tauri shell sidecar — runs `stt --json-mode` as a child process
        const { Command } = await import("@tauri-apps/plugin-shell");
        const cmd = Command.create("stt-sidecar", args);
        cmd.stdout.on("data", (line: string) => {
          try {
            const event: STTEvent = JSON.parse(line);
            for (const cb of listeners) cb(event);
          } catch { /* partial line, ignore */ }
        });
        cmd.on("close", () => { /* process exited */ });
        cmd.on("error", (err: string) => {
          for (const cb of listeners) cb({ type: "error", message: err });
        });
        child = await cmd.spawn();
      } catch (err) {
        // fallback: not in Tauri sidecar env — try PATH
        const { Command } = await import("@tauri-apps/plugin-shell");
        const cmd = Command.create("stt", args);
        cmd.stdout.on("data", (line: string) => {
          try {
            const event: STTEvent = JSON.parse(line);
            for (const cb of listeners) cb(event);
          } catch { }
        });
        child = await cmd.spawn();
      }
    },

    stop() {
      if (child) {
        try { child.kill(); } catch { }
      }
    },
  };
}
