// ── WebSocket dev mode: connects to `stt --ws-port 8765` ──
import { type STTApi, type STTEvent } from "./api";

export function createWsApi(port: number = 8765): STTApi {
  let ws: WebSocket | null = null;
  let listeners: Array<(e: STTEvent) => void> = [];

  return {
    onEvent(cb) { listeners.push(cb); },

    async spawn() {
      return new Promise<void>((resolve, reject) => {
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.onopen = () => {
          console.log("[Engine] WebSocket connected");
          resolve();
        };
        ws.onmessage = (msg) => {
          try {
            const event: STTEvent = JSON.parse(msg.data);
            for (const cb of listeners) cb(event);
          } catch { }
        };
        ws.onerror = () => reject(new Error("WebSocket connection failed"));
        ws.onclose = () => {
          for (const cb of listeners) cb({ type: "state", state: "idle" });
        };
      });
    },

    kill() {
      listeners = [];
      ws?.close();
      ws = null;
    },

    start() {
      this.sendCommand({ type: "start_recording" });
    },

    stop() {
      this.sendCommand({ type: "stop_recording" });
    },

    sendCommand(cmd: Record<string, unknown>) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd));
      }
    },
  };
}
