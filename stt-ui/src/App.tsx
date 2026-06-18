import { useEffect, useMemo, useRef, useState, useReducer, useCallback } from "react";
import type { STTApi, STTEvent } from "./api";
import { createTauriApi } from "./api-tauri";
import { createWebAudioApi } from "./api-web-audio";
import { Mic } from "lucide-react";
import OnboardingWizard from "./components/OnboardingWizard";
import MicButton from "./components/MicButton";
import ErrorBanner from "./components/ErrorBanner";
import type { AppError } from "./components/ErrorBanner";
import HistoryPanel from "./components/HistoryPanel";
import SettingsPanel from "./components/SettingsPanel";
import InsightsPage from "./components/InsightsPage";
import DictionaryPage from "./components/DictionaryPage";
import SnippetsPage from "./components/SnippetsPage";
import { AppShell } from "./layouts/AppShell";
import { AppStateContext, type AppView, DEFAULT_ONBOARDING, onboardingReducer } from "./store";
import { micLevelEmitter } from "./utils/mic-emitter";
import { usePermissions } from "./hooks/usePermissions";
import Waveform from "./components/Waveform";

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
  hotwords: string;
  language: string;
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
  hotwords: "",
  language: "",
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
  if (settings.hotwords.trim()) args.push("--hotwords", settings.hotwords.trim());
  if (settings.language.trim()) args.push("--language", settings.language.trim());
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

function detectRunMode(): RunMode {
  if (typeof window !== "undefined" && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    return "tauri";
  }
  return "ws";
}

function LiveFeedMicMeter() {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return micLevelEmitter.subscribe((level) => {
      if (fillRef.current) {
        fillRef.current.style.width = `${Math.min(100, level * 220)}%`;
      }
    });
  }, []);

  return (
    <div className="flex-1 h-1.5 rounded-full bg-app-surface-secondary overflow-hidden">
      <div ref={fillRef} className="h-full bg-accent rounded-full transition-[width] duration-75" style={{ width: "0%" }} />
    </div>
  );
}

function SessionStats({ lines }: { lines: TranscriptLine[] }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const interval = setInterval(() => { setElapsed(Date.now() - startRef.current); }, 1000);
    return () => clearInterval(interval);
  }, []);

  const totalWords = lines.reduce((sum, l) => {
    const text = l.processed || l.raw;
    return sum + (text ? text.split(/\s+/).filter(Boolean).length : 0);
  }, 0);

  const minutes = Math.max(elapsed / 60000, 0.01);
  const wpm = Math.round(totalWords / minutes);

  return (
    <>
      <span>{wpm} WPM</span>
      <span>{totalWords} words</span>
      <span>{Math.round(elapsed / 60000)}m</span>
    </>
  );
}

function FeedView({
  connected,
  status,
  lines,
  historyItems,
  historyLoading,
  hasMoreHistory,
  onFeedScroll,
  start,
  stop,
  copyLatest,
  copyLine,
  clearLines,
  feedRef,
  errors,
  showErrors,
  setShowErrors,
  dismissError,
}: {
  connected: boolean;
  status: string;
  lines: TranscriptLine[];
  historyItems: TranscriptLine[];
  historyLoading: boolean;
  hasMoreHistory: boolean;
  onFeedScroll: () => void;
  start: (overrideSettings?: RuntimeSettings) => Promise<void>;
  stop: () => void;
  copyLatest: () => void;
  copyLine: (line: TranscriptLine) => void;
  clearLines: () => void;
  feedRef: React.RefObject<HTMLDivElement | null>;
  errors: AppError[];
  showErrors: boolean;
  setShowErrors: (v: boolean | ((s: boolean) => boolean)) => void;
  dismissError: (id: string) => void;
}) {
  const handleToggle = () => {
    if (connected) {
      stop();
    } else {
      void start();
    }
  };

  const statusLabel = (() => {
    switch (status) {
      case "listening": return "Listening";
      case "transcribing": return "Transcribing";
      case "rewriting": return "Rewriting";
      case "error": return "Error";
      default: return "Idle";
    }
  })();

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col p-6 overflow-hidden">
        {/* Centered mic area */}
        <div className="flex flex-col items-center gap-3 mb-4">
          <MicButton
            status={status}
            connected={connected}
            onToggle={handleToggle}
          />
          <p className="text-[13px] text-[#7A7F87]">
            {statusLabel} &middot; {lines.length} lines
          </p>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[12px] text-[13px] font-medium text-[#7A7F87] hover:text-[#F7F4EE] hover:bg-white/[0.04] transition-colors disabled:opacity-40"
              onClick={() => void copyLatest()}
              disabled={lines.length === 0}
            >
              Copy
            </button>
            <button
              className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[12px] text-[13px] font-medium text-[#7A7F87] hover:text-[#F7F4EE] hover:bg-white/[0.04] transition-colors disabled:opacity-40"
              onClick={clearLines}
              disabled={lines.length === 0}
            >
              Clear
            </button>
            {errors.filter((e) => !e.dismissed).length > 0 && (
              <button
                className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[12px] text-[13px] font-medium text-[#7A7F87] hover:text-[#F7F4EE] hover:bg-white/[0.04] transition-colors"
                onClick={() => setShowErrors((s) => !s)}
              >
                Errors ({errors.filter((e) => !e.dismissed).length})
              </button>
            )}
          </div>
        </div>

        {/* Feed */}
        <div
          className="flex-1 bg-[#0B0F14] rounded-[28px] border border-white/[0.04] overflow-hidden flex flex-col"
        >
          {/* Feed Header */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/[0.04]">
            <LiveFeedMicMeter />
            {connected && <Waveform width={120} height={24} barCount={16} />}
            <div className="flex items-center gap-2 text-[12px]">
              <span className={connected ? "text-green-400" : "text-[#7A7F87]"}>
                {connected ? "● Live" : "○ Idle"}
              </span>
              <span className="text-[#7A7F87]">{lines.length + historyItems.length} lines</span>
            </div>
            {connected && (
              <div className="ml-auto flex items-center gap-4 text-[12px] text-[#7A7F87]">
                <SessionStats lines={lines} />
              </div>
            )}
          </div>

          {/* Transcript Lines */}
          <div className="flex-1 overflow-auto" ref={feedRef} onScroll={onFeedScroll}>
            {lines.length === 0 && historyItems.length === 0 && !historyLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Mic size={72} strokeWidth={1} className="text-[rgba(199,119,44,0.8)] mb-4" />
                <p className="text-[#F7F4EE] text-[15px] mb-1">Start speaking to begin transcription</p>
                <p className="text-[#7A7F87] text-[13px]">
                  Press <kbd className="px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.08] rounded text-[#7A7F87] text-[11px]">Space</kbd> to start or stop
                </p>
              </div>
            ) : (
              <>
                {[...lines].reverse().map((line) => (
                  <div
                    key={`live-${line.id}`}
                    className="group flex items-center justify-between px-4 hover:bg-white/[0.02] transition-colors"
                    style={{ paddingTop: "16px", paddingBottom: "16px" }}
                  >
                    <div className="flex items-baseline gap-3 min-w-0">
                      <span className="text-[13px] text-[#7A7F87] shrink-0 w-[80px]">
                        {new Date(line.createdAt).toLocaleTimeString()}
                      </span>
                      <span className="text-[16px] leading-[1.7] text-[#F7F4EE] truncate">
                        {line.processed || line.raw}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-[14px] text-[#7A7F87] hover:text-[#F7F4EE] transition-colors"
                        onClick={() => void copyLine(line)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ))}
                {historyItems.map((item) => (
                  <div
                    key={`hist-${item.id}`}
                    className="group flex items-center justify-between px-4 hover:bg-white/[0.02] transition-colors border-t border-white/[0.03]"
                    style={{ paddingTop: "16px", paddingBottom: "16px" }}
                  >
                    <div className="flex items-baseline gap-3 min-w-0">
                      <span className="text-[13px] text-[#7A7F87] shrink-0 w-[80px]">
                        {new Date(item.createdAt + (item.createdAt.includes("Z") ? "" : "Z")).toLocaleTimeString()}
                      </span>
                      <span className="text-[16px] leading-[1.7] text-[#F7F4EE]/70 whitespace-pre-wrap break-words">
                        {item.processed || item.raw}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-[14px] text-[#7A7F87] hover:text-[#F7F4EE] transition-colors"
                        onClick={() => void copyLine(item)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ))}
                {historyLoading && (
                  <div className="flex items-center justify-center py-6 text-[13px] text-[#7A7F87]">
                    Loading history...
                  </div>
                )}
                {!hasMoreHistory && historyItems.length > 0 && (
                  <div className="flex items-center justify-center py-6 text-[13px] text-[#7A7F87]">
                    No more history
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

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
    </div>
  );
}

function ConfigView({
  mode,
  setMode,
  settings,
  setSettings,
  commandPreview,
  permissions,
  requestClipboard,
  requestMic,
  isCapturingMic,
  stopMic,
}: {
  mode: RunMode;
  setMode: (m: RunMode) => void;
  settings: RuntimeSettings;
  setSettings: React.Dispatch<React.SetStateAction<RuntimeSettings>>;
  commandPreview: string;
  permissions: { clipboard: string; microphone: string };
  requestClipboard: () => Promise<boolean>;
  requestMic: () => Promise<boolean>;
  isCapturingMic: boolean;
  stopMic: () => void;
}) {
  const permissionStatusColor = (status: string) => {
    switch (status) {
      case "granted": return "text-green-400";
      case "denied": return "text-red-400";
      case "prompt": return "text-yellow-400";
      default: return "text-text-muted";
    }
  };

  const permissionStatusIcon = (status: string) => {
    switch (status) {
      case "granted": return "✓";
      case "denied": return "✗";
      case "prompt": return "?";
      default: return "—";
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="bg-app-surface rounded-card border border-border p-5 space-y-5">
        {/* Connection */}
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold text-text-primary mb-3">
            <span>📡</span> Connection
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-text-secondary w-20 shrink-0">Mode</label>
              <select
                className="flex-1 h-9 px-3 bg-app-surface-secondary border border-border rounded-input text-[14px] text-text-primary focus:outline-none focus:border-accent"
                value={mode}
                onChange={(e) => setMode(e.target.value as RunMode)}
              >
                <option value="ws">WebSocket (external stt)</option>
                <option value="tauri">Tauri local process</option>
              </select>
            </div>
            {mode === "ws" && (
              <div className="flex items-center gap-3">
                <label className="text-[13px] text-text-secondary w-20 shrink-0">WS Port</label>
                <input
                  className="flex-1 h-9 px-3 bg-app-surface-secondary border border-border rounded-input text-[14px] text-text-primary focus:outline-none focus:border-accent"
                  type="number"
                  value={settings.wsPort}
                  onChange={(e) => setSettings((s) => ({ ...s, wsPort: Number(e.target.value) || 8765 }))}
                />
              </div>
            )}
          </div>
        </div>

        <div className="h-px bg-white/[0.04]" />

        {/* Permissions */}
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold text-text-primary mb-3">
            <span>🔐</span> Permissions
          </div>
          <div className="space-y-3">
            {/* Clipboard Permission */}
            <div className="flex items-center justify-between rounded-card bg-app-surface-secondary border border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-[14px]">📋</span>
                <div>
                  <div className="text-[13px] font-medium text-text-primary">Clipboard Access</div>
                  <div className="text-[11px] text-text-muted">Copy transcribed text to clipboard</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-medium ${permissionStatusColor(permissions.clipboard)}`}>
                  {permissionStatusIcon(permissions.clipboard)} {permissions.clipboard}
                </span>
                {permissions.clipboard !== "granted" && (
                  <button
                    onClick={() => void requestClipboard()}
                    className="h-7 px-3 rounded-button text-[12px] font-medium bg-accent text-white hover:bg-accent-warm transition-colors"
                  >
                    Grant
                  </button>
                )}
              </div>
            </div>

            {/* Microphone Permission */}
            <div className="flex items-center justify-between rounded-card bg-app-surface-secondary border border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="text-[14px]">🎤</span>
                <div>
                  <div className="text-[13px] font-medium text-text-primary">Microphone Access</div>
                  <div className="text-[11px] text-text-muted">Capture audio for speech recognition</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[12px] font-medium ${permissionStatusColor(permissions.microphone)}`}>
                  {permissionStatusIcon(permissions.microphone)} {permissions.microphone}
                </span>
                {permissions.microphone !== "granted" ? (
                  <button
                    onClick={() => void requestMic()}
                    className="h-7 px-3 rounded-button text-[12px] font-medium bg-accent text-white hover:bg-accent-warm transition-colors"
                  >
                    Grant
                  </button>
                ) : (
                  <button
                    onClick={isCapturingMic ? stopMic : () => void requestMic()}
                    className={`h-7 px-3 rounded-button text-[12px] font-medium transition-colors ${
                      isCapturingMic
                        ? "bg-red-900/40 border border-red-500/30 text-red-400 hover:bg-red-900/60"
                        : "bg-app-surface border border-border text-text-primary hover:bg-app-hover"
                    }`}
                  >
                    {isCapturingMic ? "Stop Test" : "Test Mic"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-white/[0.04]" />

        {/* Speech */}
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold text-text-primary mb-3">
            <span>🎤</span> Speech
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-text-secondary w-20 shrink-0">ASR Profile</label>
              <select
                className="flex-1 h-9 px-3 bg-app-surface-secondary border border-border rounded-input text-[14px] text-text-primary focus:outline-none focus:border-accent"
                value={settings.asrProfile}
                onChange={(e) => setSettings((s) => ({ ...s, asrProfile: e.target.value as RuntimeSettings["asrProfile"] }))}
              >
                <option value="auto">auto</option>
                <option value="speed">speed</option>
                <option value="balanced">balanced</option>
                <option value="accuracy">accuracy</option>
                <option value="distil">distil</option>
                <option value="turbo">turbo</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-text-secondary w-20 shrink-0">Backend</label>
              <select
                className="flex-1 h-9 px-3 bg-app-surface-secondary border border-border rounded-input text-[14px] text-text-primary focus:outline-none focus:border-accent"
                value={settings.backend}
                onChange={(e) => setSettings((s) => ({ ...s, backend: e.target.value as RuntimeSettings["backend"] }))}
              >
                <option value="auto">auto</option>
                <option value="whisper_cpp">whisper.cpp</option>
                <option value="faster_whisper">faster-whisper</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-text-secondary w-20 shrink-0">Model</label>
              <input
                className="flex-1 h-9 px-3 bg-app-surface-secondary border border-border rounded-input text-[14px] text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-accent"
                value={settings.model}
                onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                placeholder="e.g. large-v3-turbo"
              />
            </div>
          </div>
        </div>

        <div className="h-px bg-white/[0.04]" />

        {/* Output */}
        <div>
          <div className="flex items-center gap-2 text-[14px] font-semibold text-text-primary mb-3">
            <span>⚙</span> Output
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-text-secondary w-20 shrink-0">LLM Mode</label>
              <select
                className="flex-1 h-9 px-3 bg-app-surface-secondary border border-border rounded-input text-[14px] text-text-primary focus:outline-none focus:border-accent"
                value={settings.llmMode}
                onChange={(e) => setSettings((s) => ({ ...s, llmMode: e.target.value as RuntimeSettings["llmMode"] }))}
              >
                <option value="cleanup">cleanup</option>
                <option value="off">off</option>
                <option value="bullet_list">bullet list</option>
                <option value="email">email</option>
                <option value="commit_message">commit message</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-4">
              {([
                { key: "fastCommit" as const, label: "fast commit" },
                { key: "typing" as const, label: "type to focused input" },
                { key: "clipboard" as const, label: "clipboard" },
                { key: "debug" as const, label: "debug" },
              ]).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-2 text-[13px] text-text-secondary cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings[key]}
                    onClick={() => setSettings((s) => ({ ...s, [key]: !s[key] }))}
                    className={`relative w-9 h-5 rounded-full border transition-colors ${
                      settings[key]
                        ? "bg-accent border-accent"
                        : "bg-app-surface-secondary border-border"
                    }`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${
                      settings[key]
                        ? "left-[18px] bg-white"
                        : "left-0.5 bg-text-secondary"
                    }`} />
                  </button>
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="h-px bg-white/[0.04]" />

        {/* Command preview */}
        <div className="bg-app-surface-secondary rounded-card border border-border p-3">
          <div className="flex items-center justify-between text-[11px] text-text-muted mb-1.5">
            <span>Command preview</span>
            <span>{mode === "ws" ? "restart backend to apply" : "applies on next start"}</span>
          </div>
          <code className="text-[13px] text-accent-light font-mono">{commandPreview}</code>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<RunMode>(detectRunMode);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState<RuntimeSettings>(getInitialSettings);
  const [status, setStatus] = useState("idle");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [toast, setToast] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [view, setView] = useState<AppView>(
    localStorage.getItem("onboarding_completed") === "true" ? "main" : "onboarding"
  );
  const [errors, setErrors] = useState<AppError[]>([]);
  const [onboarding, onboardingDispatch] = useReducer(onboardingReducer, DEFAULT_ONBOARDING);
  const [activeItem, setActiveItem] = useState("Home");
  const [historyItems, setHistoryItems] = useState<TranscriptLine[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const historyWsRef = useRef<WebSocket | null>(null);

  const runtimeRef = useRef<STTApi | null>(null);
  const nextLocalId = useRef(1);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const connectedRef = useRef(connected);
  const isStartingRef = useRef(false);
  const startRef = useRef<(overrideSettings?: RuntimeSettings) => Promise<void>>(async () => {});
  const stopRef = useRef<() => void>(() => {});
  connectedRef.current = connected;
  const { permissions, requestClipboard, requestMic, isCapturingMic, stopMic } = usePermissions();

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      setMode("tauri");
    }
  }, []);

  // Load history from backend
  const fetchHistory = useCallback(async (page: number, pageSize: number = 200) => {
    setHistoryLoading(true);
    try {
      if (mode === "tauri") {
        const { invoke } = await import("@tauri-apps/api/core");
        const rows = await invoke<Array<{ id: number; raw_text: string; processed_text: string; created_at: string; mode: string; language: string; duration_sec: number }>>("get_history", { limit: page * pageSize });
        const items: TranscriptLine[] = rows.map((r) => ({
          id: r.id,
          raw: r.raw_text,
          processed: r.processed_text,
          status: "done",
          createdAt: r.created_at,
        }));
        setHistoryItems(items);
        setHasMoreHistory(rows.length >= page * pageSize);
      } else if (mode === "ws") {
        const ws = new WebSocket(`ws://127.0.0.1:${settings.wsPort}`);
        historyWsRef.current = ws;
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error("WS failed"));
        });
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data.type === "history") {
              const items: TranscriptLine[] = data.rows.map((r: any) => ({
                id: r.id,
                raw: r.raw_text,
                processed: r.processed_text,
                status: "done",
                createdAt: r.created_at,
              }));
              setHistoryItems(items);
              setHasMoreHistory(data.rows.length >= page * pageSize);
              ws.close();
            }
          } catch { }
        };
        ws.send(JSON.stringify({ type: "get_history", limit: page * pageSize }));
      }
    } catch {
      setHasMoreHistory(false);
    } finally {
      setHistoryLoading(false);
    }
  }, [mode, settings.wsPort]);

  // Load history on mount
  useEffect(() => {
    if (view === "main") {
      fetchHistory(1);
    }
  }, [view, fetchHistory]);

  // Infinite scroll: load more when scrolling to bottom
  const handleFeedScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el || historyLoading || !hasMoreHistory) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      const nextPage = historyPage + 1;
      setHistoryPage(nextPage);
      fetchHistory(nextPage);
    }
  }, [historyLoading, hasMoreHistory, historyPage, fetchHistory]);

  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVH();
    window.addEventListener('resize', setVH);
    return () => window.removeEventListener('resize', setVH);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!feedRef.current) return;
    feedRef.current.scrollTop = 0;
  }, [lines]);

  useEffect(() => {
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const prefix = status === "idle" ? "○" : status === "listening" ? "🎙" : status === "transcribing" ? "✍" : "●";
        await win.setTitle(`${prefix} STT — ${status}`);
      } catch { /* not in Tauri */ }
    })();
  }, [status]);

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
      micLevelEmitter.emit(event.level);
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

  const dismissErrorsOfCategory = (category: AppError["category"]) => {
    setErrors((prev) => prev.map((e) => (e.category === category ? { ...e, dismissed: true } : e)));
  };

  const start = async (overrideSettings?: RuntimeSettings) => {
    if (connected || isStartingRef.current) return;
    const activeSettings = overrideSettings ?? settings;
    isStartingRef.current = true;
    const api: STTApi = mode === "ws" ? createWebAudioApi(activeSettings.wsPort) : createTauriApi(buildCliArgs(activeSettings));
    api.onEvent(applyEvent);
    try {
      await api.start();
      runtimeRef.current = api;
      setConnected(true);
      setStatus("listening");
      dismissErrorsOfCategory("connection");
    } catch (error) {
      try { api.stop(); } catch { /* best effort */ }
      const msg = error instanceof Error ? error.message : "Failed to start runtime";
      setToast(msg);
      addError("connection", msg, true, "Check if stt-engine is installed");
    } finally {
      isStartingRef.current = false;
    }
  };

  const stop = () => {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    setConnected(false);
    setStatus("idle");
    micLevelEmitter.emit(0);
  };

  startRef.current = start;
  stopRef.current = stop;

  useEffect(() => () => runtimeRef.current?.stop(), []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenShortcut: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("tray-action", (event) => {
          if (event.payload === "start" && !connectedRef.current) {
            void startRef.current();
          } else if (event.payload === "stop" && connectedRef.current) {
            stopRef.current();
          }
        });
      } catch { /* not in Tauri */ }
      // Register global shortcut Super+Space
      try {
        const { register } = await import("@tauri-apps/plugin-global-shortcut");
        await register("Super+Space", (event) => {
          if (event.state === "Pressed") {
            if (connectedRef.current) stopRef.current();
            else void startRef.current();
          }
        });
      } catch { /* not in Tauri or shortcut blocked */ }
    })();
    return () => { unlisten?.(); unlistenShortcut?.(); };
  }, []);

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

  const handleOnboardingComplete = () => {
    localStorage.setItem("onboarding_completed", "true");
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

  const handleNavigate = (item: string) => {
    setActiveItem(item);
    if (item === "Settings") {
      setShowSettings(true);
    }
  };

  const content = (() => {
    switch (activeItem) {
      case "Config":
        return (
          <ConfigView
            mode={mode}
            setMode={setMode}
            settings={settings}
            setSettings={setSettings}
            commandPreview={commandPreview}
            permissions={permissions}
            requestClipboard={requestClipboard}
            requestMic={requestMic}
            isCapturingMic={isCapturingMic}
            stopMic={stopMic}
          />
        );
      case "Insights":
        return <InsightsPage />;
      case "Dictionary":
        return <DictionaryPage />;
      case "Snippets":
        return <SnippetsPage />;
      case "Settings":
        return null;
      default:
        return (
          <FeedView
            connected={connected}
            status={status}
            lines={lines}
            historyItems={historyItems}
            historyLoading={historyLoading}
            hasMoreHistory={hasMoreHistory}
            onFeedScroll={handleFeedScroll}
            start={start}
            stop={stop}
            copyLatest={copyLatest}
            copyLine={copyLine}
            clearLines={clearLines}
            feedRef={feedRef}
            errors={errors}
            showErrors={showErrors}
            setShowErrors={setShowErrors}
            dismissError={dismissError}
          />
        );
    }
  })();

  return (
    <AppStateContext.Provider value={{ onboarding, onboardingDispatch, view, setView }}>
      <AppShell activeItem={activeItem} onNavigate={handleNavigate}>
        {content}
      </AppShell>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-app-surface border border-border rounded-card text-[14px] text-text-primary shadow-lg animate-in fade-in slide-in-from-bottom-2">
          {toast}
        </div>
      )}
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
        onClose={() => {
          setShowSettings(false);
          setActiveItem("Home");
        }}
      />
    </AppStateContext.Provider>
  );
}

export default App;
