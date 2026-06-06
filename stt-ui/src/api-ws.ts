// ── WebSocket dev mode: connects to `stt --ws-port 8765` ──
import { type STTApi, type STTEvent } from "./api";

export function createWsApi(port: number = 8765): STTApi {
  let ws: WebSocket | null = null;
  let listeners: Array<(e: STTEvent) => void> = [];

  return {
    onEvent(cb) { listeners.push(cb); },

    start() {
      return new Promise<void>((resolve, reject) => {
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.onopen = () => resolve();
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

    stop() {
      ws?.close();
      ws = null;
    },
  };
}
