// ── STT API — abstract interface for backend communication ──

export type STTEvent =
  | { type: "state"; state: string; utterance_id?: number }
  | { type: "raw"; text: string; utterance_id?: number }
  | { type: "processed"; text: string; utterance_id?: number }
  | { type: "llm_partial"; text: string; utterance_id?: number }
  | { type: "mic"; level: number }
  | { type: "error"; message: string; utterance_id?: number }
  | { type: "dropped"; reason: string; duration_sec?: number; utterance_id?: number };

export interface STTApi {
  start(): Promise<void>;
  stop(): void;
  onEvent(cb: (e: STTEvent) => void): void;
}
