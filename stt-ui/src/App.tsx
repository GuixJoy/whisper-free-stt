import { useEffect, useMemo, useRef, useState } from "react";
import type { STTApi, STTEvent } from "./api";
import { createWsApi } from "./api-ws";
import { createTauriApi } from "./api-tauri";
import "./App.css";

type RunMode = "ws" | "tauri";

interface TranscriptLine {
  id: number;
  raw: string;
  processed: string;
  status: string;
  createdAt: string;
}

interface RuntimeSettings {
  wsPort: number;
  asrProfile: "auto" | "speed" | "balanced" | "accuracy" | "distil" | "turbo";
  backend: "auto" | "whisper_cpp" | "faster_whisper";
  model: string;
  llmMode: "cleanup" | "off" | "bullet_list" | "email" | "commit_message";
  fastCommit: boolean;
  typing: boolean;
  clipboard: boolean;
  debug: boolean;
}

const DEFAULT_SETTINGS: RuntimeSettings = {
  wsPort: 8765,
  asrProfile: "auto",
  backend: "auto",
  model: "",
  llmMode: "cleanup",
  fastCommit: true,
  typing: false,
  clipboard: false,
  debug: false,
};

function buildCliArgs(settings: RuntimeSettings): string[] {
  const args: string[] = ["--json-mode", "--asr-profile", settings.asrProfile, "--llm-mode", settings.llmMode];
  if (settings.backend !== "auto") args.push("--backend", settings.backend);
  if (settings.model.trim()) args.push("--model", settings.model.trim());
  if (settings.fastCommit) args.push("--fast-commit");
  if (!settings.typing) args.push("--no-type");
  if (settings.clipboard) args.push("--clipboard");
  if (settings.debug) args.push("--debug");
  return args;
}

function buildWsCommand(settings: RuntimeSettings): string {
  const args = [
    "--ws-port",
    String(settings.wsPort),
    "--asr-profile",
    settings.asrProfile,
    "--llm-mode",
    settings.llmMode,
  ];
  if (settings.backend !== "auto") args.push("--backend", settings.backend);
  if (settings.model.trim()) args.push("--model", settings.model.trim());
  if (settings.fastCommit) args.push("--fast-commit");
  if (!settings.typing) args.push("--no-type");
  if (settings.clipboard) args.push("--clipboard");
  if (settings.debug) args.push("--debug");
  return `stt ${args.join(" ")}`;
}

function App() {
  const [mode, setMode] = useState<RunMode>("ws");
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState<RuntimeSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [toast, setToast] = useState("");
  const [showControls, setShowControls] = useState(true);

  const runtimeRef = useRef<STTApi | null>(null);
  const nextLocalId = useRef(1);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      setMode("tauri");
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [lines]);

  const commandPreview = useMemo(() => {
    if (mode === "ws") return buildWsCommand(settings);
    return `stt ${buildCliArgs(settings).join(" ")}`;
  }, [mode, settings]);

  const applyEvent = (event: STTEvent) => {
    if (event.type === "state") {
      setStatus(event.state === "copied" ? "idle" : event.state);
      return;
    }
    if (event.type === "mic") {
      setMicLevel(event.level);
      return;
    }
    if (event.type === "error") {
      setToast(event.message);
      setStatus("error");
      if (event.utterance_id) {
        setLines((prev) => prev.map((line) => (
          line.id === event.utterance_id ? { ...line, status: "error" } : line
        )));
      }
      return;
    }
    if (event.type === "dropped") {
      setToast(`Dropped (${event.reason})`);
      return;
    }
    if (event.type === "raw") {
      const id = event.utterance_id ?? nextLocalId.current++;
      setLines((prev) => [
        ...prev,
        {
          id,
          raw: event.text,
          processed: "",
          status: "transcribing",
          createdAt: new Date().toISOString(),
        },
      ].slice(-500));
      return;
    }
    if (event.type === "processed") {
      const id = event.utterance_id;
      if (!id) return;
      setLines((prev) => prev.map((line) => (
        line.id === id ? { ...line, processed: event.text, status: "done" } : line
      )));
    }
  };

  const start = async () => {
    if (connected) return;
    const api: STTApi = mode === "ws" ? createWsApi(settings.wsPort) : createTauriApi(buildCliArgs(settings));
    api.onEvent(applyEvent);
    try {
      await api.start();
      runtimeRef.current = api;
      setConnected(true);
      setStatus("listening");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Failed to start runtime");
    }
  };

  const stop = () => {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    setConnected(false);
    setStatus("idle");
  };

  useEffect(() => () => stop(), []);

  const clearLines = () => setLines([]);

  const copyLatest = async () => {
    const latest = lines[lines.length - 1];
    if (!latest) return;
    await navigator.clipboard.writeText(latest.processed || latest.raw);
    setToast("Copied latest");
  };

  return (
    <div className="paper-shell">
      <header className="app-header">
        <h1>✎ STT Feed</h1>
        <div className="flex items-center gap-2">
          <span className={`status-badge ${status === "error" ? "status-error" : status === "rewriting" ? "status-rewriting" : status === "transcribing" ? "status-transcribing" : status === "listening" ? "status-listening" : "status-idle"}`}>
            {status}
          </span>
          <button className="sketch-btn" onClick={() => setShowControls((s) => !s)}>
            {showControls ? "Hide controls" : "Show controls"}
          </button>
        </div>
      </header>

      <main className="canvas-layout">
        {showControls && (
          <aside className="controls-panel">
            <div className="controls-row">
              <label>Mode</label>
              <select className="sketch-input" value={mode} onChange={(e) => setMode(e.target.value as RunMode)}>
                <option value="ws">WebSocket (external stt)</option>
                <option value="tauri">Tauri local process</option>
              </select>
            </div>

            <div className="controls-row">
              <label>WS Port</label>
              <input className="sketch-input" type="number" value={settings.wsPort} onChange={(e) => setSettings((s) => ({ ...s, wsPort: Number(e.target.value) || 8765 }))} />
            </div>

            <div className="controls-row">
              <label>ASR Profile</label>
              <select className="sketch-input" value={settings.asrProfile} onChange={(e) => setSettings((s) => ({ ...s, asrProfile: e.target.value as RuntimeSettings["asrProfile"] }))}>
                <option value="auto">auto</option>
                <option value="speed">speed</option>
                <option value="balanced">balanced</option>
                <option value="accuracy">accuracy</option>
                <option value="distil">distil</option>
                <option value="turbo">turbo</option>
              </select>
            </div>

            <div className="controls-row">
              <label>Backend</label>
              <select className="sketch-input" value={settings.backend} onChange={(e) => setSettings((s) => ({ ...s, backend: e.target.value as RuntimeSettings["backend"] }))}>
                <option value="auto">auto</option>
                <option value="whisper_cpp">whisper_cpp</option>
                <option value="faster_whisper">faster_whisper</option>
              </select>
            </div>

            <div className="controls-row">
              <label>Model override</label>
              <input className="sketch-input" value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))} placeholder="e.g. large-v3-turbo" />
            </div>

            <div className="controls-row">
              <label>LLM Mode</label>
              <select className="sketch-input" value={settings.llmMode} onChange={(e) => setSettings((s) => ({ ...s, llmMode: e.target.value as RuntimeSettings["llmMode"] }))}>
                <option value="cleanup">cleanup</option>
                <option value="off">off</option>
                <option value="bullet_list">bullet_list</option>
                <option value="email">email</option>
                <option value="commit_message">commit_message</option>
              </select>
            </div>

            <div className="controls-checks">
              <label><input type="checkbox" checked={settings.fastCommit} onChange={(e) => setSettings((s) => ({ ...s, fastCommit: e.target.checked }))} /> fast commit</label>
              <label><input type="checkbox" checked={settings.typing} onChange={(e) => setSettings((s) => ({ ...s, typing: e.target.checked }))} /> type to focused input</label>
              <label><input type="checkbox" checked={settings.clipboard} onChange={(e) => setSettings((s) => ({ ...s, clipboard: e.target.checked }))} /> clipboard</label>
              <label><input type="checkbox" checked={settings.debug} onChange={(e) => setSettings((s) => ({ ...s, debug: e.target.checked }))} /> debug</label>
            </div>

            <div className="controls-actions">
              {!connected ? (
                <button className="sketch-btn" onClick={start}>▶ Start</button>
              ) : (
                <button className="sketch-btn recording" onClick={stop}>■ Stop</button>
              )}
              <button className="sketch-btn" onClick={copyLatest}>📋 Copy last</button>
              <button className="sketch-btn" onClick={clearLines}>🗑 Clear</button>
            </div>

            <div className="command-preview">
              <div className="transcript-meta">
                <span>Command preview</span>
                <span>{mode === "ws" ? "restart backend to apply" : "applies on next start"}</span>
              </div>
              <code>{commandPreview}</code>
            </div>
          </aside>
        )}

        <section className="feed-board">
          <div className="hud">
            <div className="note-chip">{connected ? "connected" : "disconnected"}</div>
            <div className="note-chip">{lines.length} lines</div>
          </div>
          <div className="mic-meter">
            <div className="mic-meter-fill" style={{ width: `${Math.min(100, micLevel * 220)}%` }} />
          </div>

          <div className="line-feed" ref={feedRef}>
            {lines.length === 0 ? (
              <p className="empty-feed">Listening output will appear here line by line…</p>
            ) : (
              lines.map((line) => (
                <div key={line.id} className="feed-line">
                  <span className="feed-time">{new Date(line.createdAt).toLocaleTimeString()}</span>
                  <span className="feed-text">{line.processed || line.raw}</span>
                  <span className="feed-status">{line.status}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {toast && <div className="toast-msg">{toast}</div>}
    </div>
  );
}

export default App;
