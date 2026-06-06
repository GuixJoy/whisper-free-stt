// ── STT API — abstract interface for backend communication ──

export type STTEvent =
  | { type: "state"; state: string }
  | { type: "raw"; text: string }
  | { type: "processed"; text: string }
  | { type: "mic"; level: number }
  | { type: "error"; message: string };

export interface STTApi {
  start(): Promise<void>;
  stop(): void;
  onEvent(cb: (e: STTEvent) => void): void;
}
