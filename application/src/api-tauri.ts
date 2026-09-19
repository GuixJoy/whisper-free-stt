// ── Tauri native backend: uses Rust commands + Tauri events ──
import { type STTApi, type STTEvent } from "./api";

type EngineStatus = "idle" | "listening" | "transcribing" | "rewriting" | "done" | "error";

let currentStatus: EngineStatus = "idle";
let nextUtteranceId = 0;
let currentText = "";

interface TauriPayload {
  text?: string;
  backend?: string;
  latency_ms?: number;
  error?: string;
}

// _cliArgs accepted for call-site compatibility (App/tests pass CLI args);
// the native Tauri backend runs in-process so there is nothing to spawn with them.
export function createTauriApi(_cliArgs?: string[]): STTApi {
  void _cliArgs;
  let listeners: Array<(e: STTEvent) => void> = [];
  let unlistenFns: Array<() => void> = [];

  const emit = (e: STTEvent) => {
    for (const cb of listeners) cb(e);
  };

  const fail = (message: string, e: unknown) => {
    currentStatus = "error";
    const detail = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e ?? "");
    const fullMessage = detail ? `${message}: ${detail}` : message;
    console.error(fullMessage, e);
    emit({ type: "state", state: currentStatus, message: fullMessage });
  };

  const handleEvent = (name: string, payload: TauriPayload) => {
    switch (name) {
      case "asr_ready":
        currentStatus = "idle";
        emit({ type: "asr_ready", backend: payload.backend ?? "parakeet" });
        emit({ type: "state", state: currentStatus });
        break;
      case "asr_partial":
        currentStatus = "transcribing";
        currentText = payload.text ?? currentText;
        emit({ type: "asr_partial", text: currentText });
        break;
      case "asr_final":
        currentText = payload.text ?? currentText;
        emit({ type: "asr_final", text: currentText, latency_ms: payload.latency_ms ?? 0 });
        break;
      case "llm_start":
        currentStatus = "rewriting";
        emit({ type: "llm_start" });
        emit({ type: "state", state: currentStatus });
        break;
      case "llm_token":
        emit({ type: "llm_token", text: payload.text ?? "" });
        break;
      case "llm_end":
        currentStatus = "done";
        currentText = payload.text ?? currentText;
        emit({ type: "llm_end", text: currentText });
        emit({ type: "state", state: currentStatus });
        break;
      default:
        break;
    }
  };

  return {
    onEvent(cb) {
      listeners.push(cb);
    },

    async spawn() {
      const { listen } = await import("@tauri-apps/api/event");
      const events = [
        "asr_ready", "asr_partial", "asr_final",
        "llm_start", "llm_token", "llm_end",
        "asr_error",
      ];
      for (const eventName of events) {
        const unlisten = await listen<TauriPayload>(eventName, (event) => {
          if (eventName === "asr_error") {
            console.error("[asr_error]", event.payload?.error ?? event.payload);
            fail(event.payload?.error ?? "Unknown ASR error", event.payload);
            return;
          }
          handleEvent(eventName, event.payload ?? {});
        });
        unlistenFns.push(unlisten);
      }
      currentStatus = "idle";
      emit({ type: "state", state: currentStatus });
    },

    kill() {
      unlistenFns.forEach((un) => un());
      unlistenFns = [];
      listeners = [];
    },

    async start() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("start_listening");
        currentText = "";
        nextUtteranceId += 1;
        currentStatus = "listening";
      } catch (e) {
        fail("[Tauri] start_listening failed", e);
      }
    },

    async stop() {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("stop_listening");
        currentStatus = "done";
        emit({ type: "state", state: currentStatus });
      } catch (e) {
        fail("[Tauri] stop_listening failed", e);
      }
    },

    async sendCommand(cmd: Record<string, unknown>) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (cmd.type === "start_recording") {
          await invoke("start_listening");
          currentText = "";
          nextUtteranceId += 1;
          currentStatus = "listening";
        } else if (cmd.type === "stop_recording") {
          await invoke("stop_listening");
          currentStatus = "done";
          emit({ type: "state", state: currentStatus });
        }
      } catch (e) {
        fail("[Tauri] sendCommand failed", e);
      }
    },
  };
}
