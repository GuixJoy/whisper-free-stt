// ── STT API — abstract interface for backend communication ──
//
// Two separate lifecycles:
//   Engine: spawn() → (running) → kill()     — backend process lives permanently
//   PTT:    start() → (recording) → stop()   — mic capture per hotkey session

export type STTEvent =
  | { type: "state"; state: string; utterance_id?: number }
  | { type: "raw"; text: string; utterance_id?: number }
  | { type: "processed"; text: string; utterance_id?: number }
  | { type: "llm_partial"; text: string; utterance_id?: number }
  | { type: "mic"; level: number }
  | { type: "error"; message: string; utterance_id?: number }
  | { type: "dropped"; reason: string; duration_sec?: number; utterance_id?: number }
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
  /** Send an arbitrary command to the backend via stdin. */
  sendCommand(cmd: Record<string, unknown>): void;
  /** Subscribe to backend events. */
  onEvent(cb: (e: STTEvent) => void): void;
}
