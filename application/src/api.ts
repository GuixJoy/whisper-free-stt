// ── STT API — abstract interface for backend communication ──
//
// Two separate lifecycles:
//   Engine: spawn() → (running) → kill()     — backend process lives permanently
//   PTT:    start() → (recording) → stop()   — mic capture per hotkey session

export type STTEvent =
  | { type: "state"; state: string; utterance_id?: number; message?: string }
  | { type: "asr_ready"; backend: string }
  | { type: "asr_partial"; text: string }
  | { type: "asr_final"; text: string; latency_ms: number }
  | { type: "llm_start" }
  | { type: "llm_token"; text: string }
  | { type: "llm_end"; text: string }
  | { type: "mic"; level: number }
  | { type: "info"; profile: string; model: string; backend: string; device: string };

export interface STTApi {
  /** Spawn the backend process. Call once on app mount. */
  spawn(): Promise<void>;
  /** Kill the backend process. Call on app unmount. */
  kill(): void;
  /** Send start_recording command. Backend opens mic. */
  start(): void;
  /** Send stop_recording command. Backend stops mic, finalizes transcript. */
  stop(): void;
  /** Send an arbitrary command to the backend. */
  sendCommand(cmd: Record<string, unknown>): void;
  /** Subscribe to backend events. */
  onEvent(cb: (e: STTEvent) => void): void;
}
