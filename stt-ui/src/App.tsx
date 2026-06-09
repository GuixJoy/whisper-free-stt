import { useEffect, useMemo, useRef, useState, useReducer, useCallback } from "react";
import type { STTApi, STTEvent } from "./api";
import { createWsApi } from "./api-ws";
import { createTauriApi } from "./api-tauri";
import OnboardingWizard from "./components/OnboardingWizard";
import MicSelector from "./components/MicSelector";
import ErrorBanner from "./components/ErrorBanner";
import { type AppError } from "./components/ErrorBanner";
import HistoryPanel from "./components/HistoryPanel";
import SettingsPanel from "./components/SettingsPanel";
import { AppStateContext, type AppView, DEFAULT_ONBOARDING, onboardingReducer } from "./store";
import "./App.css";

type RunMode = "ws" | "tauri";

interface TranscriptLine {
  id: number;
  raw: string;
  processed: string;
  status: string;
  createdAt: string;
}

export interface RuntimeSettings {
  wsPort: number;
  asrProfile: "auto" | "speed" | "balanced" | "accuracy" | "distil" | "turbo";
  backend: "auto" | "whisper_cpp" | "faster_whisper";
  model: string;
  llmMode: "cleanup" | "off" | "bullet_list" | "email" | "commit_message";
  llmProvider: "deepseek" | "openrouter";
  llmModel: string;
  llmFallback: string;
  deepseekApiKey: string;
  openrouterApiKey: string;
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
  llmProvider: "openrouter",
  llmModel: "",
  llmFallback: "",
  deepseekApiKey: "",
  openrouterApiKey: "",
  fastCommit: true,
  typing: false,
  clipboard: false,
  debug: false,
};

const LOCAL_STORAGE_KEY = "stt-settings";

function getInitialSettings(): RuntimeSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.error("Failed to load settings", e);
  }
  return DEFAULT_SETTINGS;
}

function buildCliArgs(settings: RuntimeSettings): string[] {
  const args: string[] = ["--json-mode", "--asr-profile", settings.asrProfile, "--llm-mode", settings.llmMode];
  if (settings.backend !== "auto") args.push("--backend", settings.backend);
  if (settings.model.trim()) args.push("--model", settings.model.trim());
  if (settings.llmProvider !== "openrouter") args.push("--llm-provider", settings.llmProvider);
  if (settings.llmModel.trim()) args.push("--llm-model", settings.llmModel.trim());
  if (settings.llmFallback.trim()) args.push("--llm-fallback", settings.llmFallback.trim());
  if (settings.deepseekApiKey.trim()) args.push("--deepseek-api-key", settings.deepseekApiKey.trim());
  if (settings.openrouterApiKey.trim()) args.push("--openrouter-api-key", settings.openrouterApiKey.trim());
  if (settings.fastCommit) args.push("--fast-commit");
  if (!settings.typing) args.push("--no-type");
  if (settings.clipboard) args.push("--clipboard");
  if (settings.debug) args.push("--debug");
  return args;
}

function buildWsCommand(settings: RuntimeSettings): string {
  const args = [
    "--ws-port", String(settings.wsPort),
    "--asr-profile", settings.asrProfile,
    "--llm-mode", settings.llmMode,
  ];
  if (settings.backend !== "auto") args.push("--backend", settings.backend);
  if (settings.model.trim()) args.push("--model", settings.model.trim());
  if (settings.fastCommit) args.push("--fast-commit");
  if (!settings.typing) args.push("--no-type");
  if (settings.clipboard) args.push("--clipboard");
  if (settings.debug) args.push("--debug");
  return `stt ${args.join(" ")}`;
}

const STATUS_ICON: Record<string, string> = {
  listening: "🎙",
  transcribing: "✍",
  rewriting: "🔄",
  error: "⚠",
  idle: "◎",
};

function detectRunMode(): RunMode {
  if (typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return "tauri";
  }
  return "ws";
}

function App() {
  const [mode, setMode] = useState<RunMode>(detectRunMode);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState<RuntimeSettings>(getInitialSettings);
  const [status, setStatus] = useState("idle");
  const [micLevel, setMicLevel] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [toast, setToast] = useState("");
  const [showControls, setShowControls] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [view, setView] = useState<AppView>("onboarding");
  const [errors, setErrors] = useState<AppError[]>([]);
  const [onboarding, onboardingDispatch] = useReducer(onboardingReducer, DEFAULT_ONBOARDING);

  const runtimeRef = useRef<STTApi | null>(null);
  const nextLocalId = useRef(1);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const connectedRef = useRef(connected);
  const isStartingRef = useRef(false);
  const startRef = useRef<(overrideSettings?: RuntimeSettings) => Promise<void>>(async () => {});
  const stopRef = useRef<() => void>(() => {});
  connectedRef.current = connected;

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      setMode("tauri");
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!feedRef.current) return;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error("Failed to save settings", e);
    }
  }, [settings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (view === "onboarding") return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toUpperCase();
      const isInteractive =
        tag === "BUTTON" ||
        target.getAttribute("role") === "button" ||
        target.closest('[contenteditable="true"]') !== null ||
        (target as HTMLInputElement).isContentEditable === true;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA" && !isInteractive) {
        e.preventDefault();
        if (connectedRef.current) stopRef.current();
        else void startRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view]);

  const addError = useCallback((category: AppError["category"], message: string, canRetry = false, retryHint?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setErrors((prev) => [...prev, { id, category, message, canRetry, retryHint, dismissed: false }]);
    setShowErrors(true);
  }, []);

  const dismissError = useCallback((id: string) => {
    setErrors((prev) => prev.map((e) => (e.id === id ? { ...e, dismissed: true } : e)));
  }, []);

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
      addError("general", event.message, true);
      if (event.utterance_id) {
        setLines((prev) => prev.map((line) =>
          line.id === event.utterance_id ? { ...line, status: "error" } : line
        ));
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
        { id, raw: event.text, processed: "", status: "transcribing", createdAt: new Date().toISOString() },
      ].slice(-500));
      return;
    }
    if (event.type === "processed") {
      const id = event.utterance_id;
      if (!id) return;
      setLines((prev) => prev.map((line) =>
        line.id === id ? { ...line, processed: event.text, status: "done" } : line
      ));
    }
  };

  const start = async (overrideSettings?: RuntimeSettings) => {
    if (connected || isStartingRef.current) return;
    const activeSettings = overrideSettings ?? settings;
    isStartingRef.current = true;
    const api: STTApi = mode === "ws" ? createWsApi(activeSettings.wsPort) : createTauriApi(buildCliArgs(activeSettings));
    api.onEvent(applyEvent);
    try {
      await api.start();
      runtimeRef.current = api;
      setConnected(true);
      setStatus("listening");
      dismissErrorsOfCategory("connection");
    } catch (error) {
      try { api.stop(); } catch (_) { /* best effort */ }
      const msg = error instanceof Error ? error.message : "Failed to start runtime";
      setToast(msg);
      addError("connection", msg, true, "Check if stt-engine is installed");
    } finally {
      isStartingRef.current = false;
    }
  };

  const dismissErrorsOfCategory = (category: AppError["category"]) => {
    setErrors((prev) => prev.map((e) => (e.category === category ? { ...e, dismissed: true } : e)));
  };

  const stop = () => {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    setConnected(false);
    setStatus("idle");
    setMicLevel(0);
  };

  startRef.current = start;
  stopRef.current = stop;

  useEffect(() => () => runtimeRef.current?.stop(), []);

  const clearLines = () => setLines([]);

  const copyText = async (text: string, label: string) => {
    if (!navigator.clipboard) {
      setToast("Clipboard not available");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast(label);
    } catch (error) {
      console.error("copy failed", error);
      setToast(`Copy failed${error instanceof Error ? ": " + error.message : ""}`);
    }
  };

  const copyLatest = async () => {
    const latest = lines[lines.length - 1];
    if (!latest) return;
    await copyText(latest.processed || latest.raw, "Copied latest!");
  };

  const copyLine = async (line: TranscriptLine) => {
    await copyText(line.processed || line.raw, "Copied!");
  };

  const STATUS_CLASS: Record<string, string> = {
    error: "status-error",
    rewriting: "status-rewriting",
    transcribing: "status-transcribing",
    listening: "status-listening",
  };
  const statusClass = STATUS_CLASS[status] ?? "status-idle";
  const statusIcon = STATUS_ICON[status] ?? "◎";

  const handleOnboardingComplete = () => {
    setView("main");
  };

  if (view === "onboarding") {
    return (
      <AppStateContext.Provider value={{ onboarding, onboardingDispatch, view, setView }}>
        <ErrorBanner
          errors={errors}
          onDismiss={dismissError}
          onRetry={(id) => { dismissError(id); }}
          visible={showErrors}
          onClose={() => setShowErrors(false)}
        />
        <OnboardingWizard onFinished={handleOnboardingComplete} />
      </AppStateContext.Provider>
    );
  }

  return (
    <AppStateContext.Provider value={{ onboarding, onboardingDispatch, view, setView }}>
      <div className="paper-shell">
        <div className="doodle-blob blob-1" aria-hidden="true" />
        <div className="doodle-blob blob-2" aria-hidden="true" />
        <div className="doodle-blob blob-3" aria-hidden="true" />

        <header className="app-header">
          <div className="header-brand">
            <span className="brand-icon">🎙</span>
            <h1>STT Feed</h1>
          </div>
          <div className="header-right">
            <MicSelector
              selectedIndex={null}
              micLevel={micLevel}
              onSelect={() => {}}
              onTest={() => {}}
              compact
            />
            <span className={`status-badge ${statusClass}`}>
              <span className="status-icon">{statusIcon}</span>
              {status}
            </span>
            <button className="sketch-btn btn-sm" onClick={() => setShowControls((s) => !s)}>
              {showControls ? "⟵ Hide" : "☰ Controls"}
            </button>
            <button className="sketch-btn btn-sm" onClick={() => setShowHistory(true)}>
              📜 History
            </button>
            <button className="sketch-btn btn-sm" onClick={() => setShowSettings(true)}>
              ⚙ Settings
            </button>
            {errors.filter((e) => !e.dismissed).length > 0 && (
              <button
                className="sketch-btn btn-sm"
                onClick={() => setShowErrors((s) => !s)}
                style={{
                  background: "var(--w-rose)",
                  borderColor: "var(--v-rose)",
                  color: "var(--v-rose)",
                }}
              >
                ⚠️ Errors ({errors.filter((e) => !e.dismissed).length})
              </button>
            )}
          </div>
        </header>

        <main className="canvas-layout">
          {showControls && (
            <aside className="controls-panel">
              <div className="ctrl-section">
                <div className="ctrl-section-header"><span>📡</span> Connection</div>
                <div className="controls-row">
                  <label>Mode</label>
                  <select className="sketch-input" value={mode} onChange={(e) => setMode(e.target.value as RunMode)}>
                    <option value="ws">WebSocket (external stt)</option>
                    <option value="tauri">Tauri local process</option>
                  </select>
                </div>
                {mode === "ws" && (
                  <div className="controls-row">
                    <label>WS Port</label>
                    <input
                      className="sketch-input"
                      type="number"
                      value={settings.wsPort}
                      onChange={(e) => setSettings((s) => ({ ...s, wsPort: Number(e.target.value) || 8765 }))}
                    />
                  </div>
                )}
              </div>

              <div className="ctrl-section">
                <div className="ctrl-section-header"><span>🎤</span> Speech</div>
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
                    <option value="whisper_cpp">whisper.cpp</option>
                    <option value="faster_whisper">faster-whisper</option>
                  </select>
                </div>
                <div className="controls-row">
                  <label>Model override</label>
                  <input
                    className="sketch-input"
                    value={settings.model}
                    onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                    placeholder="e.g. large-v3-turbo"
                  />
                </div>
              </div>

              <div className="ctrl-section">
                <div className="ctrl-section-header"><span>⚙</span> Output</div>
                <div className="controls-row">
                  <label>LLM Mode</label>
                  <select className="sketch-input" value={settings.llmMode} onChange={(e) => setSettings((s) => ({ ...s, llmMode: e.target.value as RuntimeSettings["llmMode"] }))}>
                    <option value="cleanup">cleanup</option>
                    <option value="off">off</option>
                    <option value="bullet_list">bullet list</option>
                    <option value="email">email</option>
                    <option value="commit_message">commit message</option>
                  </select>
                </div>
                <div className="controls-checks">
                  <label className="toggle-label">
                    <span className="toggle-wrap">
                      <input type="checkbox" checked={settings.fastCommit} onChange={(e) => setSettings((s) => ({ ...s, fastCommit: e.target.checked }))} />
                      <span className="toggle-track" />
                    </span>
                    fast commit
                  </label>
                  <label className="toggle-label">
                    <span className="toggle-wrap">
                      <input type="checkbox" checked={settings.typing} onChange={(e) => setSettings((s) => ({ ...s, typing: e.target.checked }))} />
                      <span className="toggle-track" />
                    </span>
                    type to focused input
                  </label>
                  <label className="toggle-label">
                    <span className="toggle-wrap">
                      <input type="checkbox" checked={settings.clipboard} onChange={(e) => setSettings((s) => ({ ...s, clipboard: e.target.checked }))} />
                      <span className="toggle-track" />
                    </span>
                    clipboard
                  </label>
                  <label className="toggle-label">
                    <span className="toggle-wrap">
                      <input type="checkbox" checked={settings.debug} onChange={(e) => setSettings((s) => ({ ...s, debug: e.target.checked }))} />
                      <span className="toggle-track" />
                    </span>
                    debug
                  </label>
                </div>
              </div>

              <div className="controls-actions">
                {!connected ? (
                  <button className="sketch-btn btn-start" onClick={() => void start()}>▶ Start</button>
                ) : (
                  <button className="sketch-btn btn-stop" onClick={stop}>■ Stop</button>
                )}
                <button className="sketch-btn btn-copy" onClick={() => void copyLatest()} disabled={lines.length === 0}>
                  📋 Copy last
                </button>
                <button className="sketch-btn btn-clear" onClick={clearLines} disabled={lines.length === 0}>
                  🗑 Clear
                </button>
              </div>

              <p className="shortcut-hint">tip: press <kbd>Space</kbd> to start / stop</p>

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
            <div className="feed-top-bar">
              <div className="mic-meter">
                <div className="mic-meter-fill" style={{ width: `${Math.min(100, micLevel * 220)}%` }} />
              </div>
              <div className="hud">
                <div className={`note-chip ${connected ? "chip-connected" : "chip-disconnected"}`}>
                  {connected ? "● live" : "○ off"}
                </div>
                <div className="note-chip">{lines.length} lines</div>
              </div>
            </div>

            <div className="line-feed" ref={feedRef}>
              {lines.length === 0 ? (
                <div className="empty-feed">
                  <div className="empty-icon">🎙</div>
                  <p>Listening output will appear here…</p>
                  <p className="empty-hint">Press <kbd>Space</kbd> or click <strong>Start</strong> to begin</p>
                </div>
              ) : (
                lines.map((line) => (
                  <div key={line.id} className={`feed-line feed-line-${line.status}`}>
                    <div className="feed-line-inner">
                      <span className="feed-time">{new Date(line.createdAt).toLocaleTimeString()}</span>
                      <span className="feed-text">{line.processed || line.raw}</span>
                    </div>
                    <div className="feed-line-meta">
                      <span className={`feed-status-dot dot-${line.status}`} title={line.status} />
                      <button className="line-copy-btn" onClick={() => void copyLine(line)} title="Copy line">📋</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <ErrorBanner
            visible={showErrors}
            onClose={() => setShowErrors(false)}
            errors={errors}
            onDismiss={dismissError}
            onRetry={(id) => {
              dismissError(id);
              void start();
            }}
          />
        </main>

        {toast && <div className="toast-msg">{toast}</div>}
        <HistoryPanel visible={showHistory} onClose={() => setShowHistory(false)} />
        <SettingsPanel
          visible={showSettings}
          settings={settings}
          onSave={async (s) => {
            setSettings(s);
            if (connectedRef.current) {
              stopRef.current();
              setTimeout(() => {
                void startRef.current(s);
              }, 200);
            }
          }}
          onClose={() => setShowSettings(false)}
        />
      </div>
    </AppStateContext.Provider>
  );
}

export default App;
