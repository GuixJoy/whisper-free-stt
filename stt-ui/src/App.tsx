import { useEffect, useMemo, useRef, useState, useReducer, useCallback } from "react";
import { z } from "zod";
import type { STTApi, STTEvent } from "./api";
import { createTauriApi } from "./api-tauri";
import { createWebAudioApi } from "./api-web-audio";
import { Mic, PlugZap, ShieldCheck, Mic2, Sparkles, Settings2, Activity, Terminal } from "lucide-react";
import OnboardingWizard from "./components/OnboardingWizard";
import MicButton from "./components/MicButton";
import ErrorBanner from "./components/ErrorBanner";
import type { AppError } from "./components/ErrorBanner";
import HistoryPage from "./components/HistoryPage";
import SettingsPanel from "./components/SettingsPanel";
import InsightsPage from "./components/InsightsPage";
import DictionaryPage from "./components/DictionaryPage";
import SnippetsPage from "./components/SnippetsPage";
import { ConfigSection } from "./components/ConfigSection";
import { SettingRow } from "./components/SettingRow";
import { FloureSelect } from "./components/FloureSelect";
import { FloureToggle } from "./components/FloureToggle";
import { FloureInput } from "./components/FloureInput";
import ModelsPage from "./components/ModelsPage";
import { AppShell } from "./layouts/AppShell";
import { AppStateContext, type AppView, DEFAULT_ONBOARDING, onboardingReducer } from "./store";
import { micLevelEmitter } from "./utils/mic-emitter";
import { usePermissions } from "./hooks/usePermissions";
import Waveform from "./components/Waveform";

const SettingsSchema = z.object({
  wsPort: z.number().int().min(1).max(65535),
  asrProfile: z.enum(["auto", "speed", "balanced", "accuracy", "distil", "turbo"]),
  backend: z.enum(["auto", "whisper_cpp", "faster_whisper"]),
  model: z.string().max(100),
  llmMode: z.enum(["cleanup", "off", "bullet_list", "email", "commit_message"]),
  llmProvider: z.enum(["deepseek", "openrouter"]),
  llmModel: z.string().max(100),
  llmFallback: z.string().max(100),
  deepseekApiKey: z.string().max(200),
  openrouterApiKey: z.string().max(200),
  fastCommit: z.boolean(),
  typing: z.boolean(),
  clipboard: z.boolean(),
  debug: z.boolean(),
  hotwords: z.string().max(200),
  language: z.string().max(10),
});

function validateSettings(settings: unknown): settings is RuntimeSettings {
  return SettingsSchema.safeParse(settings).success;
}

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
  asrProfile: "distil",
  backend: "auto",
  model: "",
  llmMode: "cleanup",
  llmProvider: "openrouter",
  llmModel: "",
  llmFallback: "",
  deepseekApiKey: "",
  openrouterApiKey: "",
  fastCommit: true,
  typing: true,
  clipboard: true,
  debug: false,
  hotwords: "",
  language: "",
};

const LOCAL_STORAGE_KEY = "stt-settings";
const SETTINGS_VERSION = 2;

function getInitialSettings(): RuntimeSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if ((parsed as Record<string, unknown>).__version !== SETTINGS_VERSION) {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        return DEFAULT_SETTINGS;
      }
      if (validateSettings(parsed)) {
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
      console.warn("Invalid settings in localStorage, using defaults");
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

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso + (iso.includes("Z") ? "" : "Z"));
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return time;
    if (isYesterday) return `Yesterday ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  } catch {
    return iso;
  }
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
          <p className="text-[13px] text-text-muted">
            {statusLabel} &middot; {lines.length} lines
          </p>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[12px] text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-border transition-colors disabled:opacity-40"
              onClick={() => void copyLatest()}
              disabled={lines.length === 0}
            >
              Copy
            </button>
            <button
              className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[12px] text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-border transition-colors disabled:opacity-40"
              onClick={clearLines}
              disabled={lines.length === 0}
            >
              Clear
            </button>
            {errors.filter((e) => !e.dismissed).length > 0 && (
              <button
                className="inline-flex items-center gap-2 h-[36px] px-4 rounded-[12px] text-[13px] font-medium text-text-muted hover:text-text-primary hover:bg-border transition-colors"
                onClick={() => setShowErrors((s) => !s)}
              >
                Errors ({errors.filter((e) => !e.dismissed).length})
              </button>
            )}
          </div>
        </div>

        {/* Feed */}
        <div
          className="flex-1 rounded-[28px] border overflow-hidden flex flex-col"
          style={{ backgroundColor: "rgba(255,255,255,0.45)", borderColor: "rgba(44,37,32,0.06)" }}
        >
          {/* Feed Header */}
          <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid rgba(44,37,32,0.08)" }}>
            <LiveFeedMicMeter />
            {connected && <Waveform width={120} height={24} barCount={16} />}
            <div className="flex items-center gap-2 text-[12px]">
              <span className={connected ? "text-green-400" : "text-text-muted"}>
                {connected ? "● Live" : "○ Idle"}
              </span>
              <span className="text-text-muted">{lines.length + historyItems.length} lines</span>
            </div>
            {connected && (
              <div className="ml-auto flex items-center gap-4 text-[12px] text-text-muted">
                <SessionStats lines={lines} />
              </div>
            )}
          </div>

          {/* Transcript Lines */}
          <div className="flex-1 overflow-auto" ref={feedRef} onScroll={onFeedScroll}>
            {lines.length === 0 && historyItems.length === 0 && !historyLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Mic size={72} strokeWidth={1} className="text-accent/40 mb-4" />
                <p className="text-text-primary text-[15px] mb-1">Start speaking to begin transcription</p>
                <p className="text-text-muted text-[13px]">
                  Press <kbd className="px-1.5 py-0.5 bg-border border border-border-hover rounded text-text-muted text-[11px]">Space</kbd> to start or stop
                </p>
              </div>
            ) : (
              <>
                {[...lines].reverse().map((line) => (
                  <div
                    key={`live-${line.id}`}
                    className="group flex items-center justify-between px-4 hover:bg-border transition-colors"
                    style={{ paddingTop: "16px", paddingBottom: "16px" }}
                  >
                    <div className="flex items-baseline gap-3 min-w-0">
                      <span className="text-[13px] text-text-muted shrink-0 w-[80px]">
                        {new Date(line.createdAt).toLocaleTimeString()}
                      </span>
                      <span className="text-[16px] leading-[1.7] text-text-primary truncate">
                        {line.processed || line.raw}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-[14px] text-text-muted hover:text-text-primary transition-colors"
                        onClick={() => void copyLine(line)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ))}
                {historyItems
                  .filter((item) => !lines.some((l) => (l.processed || l.raw) === (item.processed || item.raw) && Math.abs(new Date(l.createdAt).getTime() - new Date(item.createdAt + (item.createdAt.includes("Z") ? "" : "Z")).getTime()) < 5000))
                  .map((item) => (
                  <div
                    key={`hist-${item.id}`}
                    className="group flex items-center justify-between px-4 hover:bg-border transition-colors border-t border-border"
                    style={{ paddingTop: "16px", paddingBottom: "16px" }}
                  >
                    <div className="flex items-baseline gap-3 min-w-0">
                      <span className="text-[13px] text-text-muted shrink-0 w-[140px]">
                        {formatTimestamp(item.createdAt)}
                      </span>
                      <span className="text-[16px] leading-[1.7] text-text-primary/70 whitespace-pre-wrap break-words">
                        {item.processed || item.raw}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        className="text-[14px] text-text-muted hover:text-text-primary transition-colors"
                        onClick={() => void copyLine(item)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ))}
                {historyLoading && (
                  <div className="flex items-center justify-center py-6 text-[13px] text-text-muted">
                    Loading history...
                  </div>
                )}
                {!hasMoreHistory && historyItems.length > 0 && (
                  <div className="flex items-center justify-center py-6 text-[13px] text-text-muted">
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
  const [clipboardOn, setClipboardOn] = useState(permissions.clipboard === "granted");
  const [micOn, setMicOn] = useState(permissions.microphone === "granted");
  return (
    <div className="flex-1 flex flex-col overflow-auto">
      <div className="flex-1 px-8 py-6 max-w-[680px] mx-auto w-full">
        <h1 className="text-[22px] font-semibold text-text-primary mb-1">Config</h1>
        <p className="text-[13px] text-text-muted mb-6">Fine-tune how Floure works for you.</p>

        <div className="flex flex-col gap-4">
          {/* Connection */}
          <ConfigSection icon={PlugZap} title="Connection" subtitle="How Floure connects to the engine">
            <SettingRow label="Mode">
              <FloureSelect
                value={mode}
                onChange={(e) => setMode(e.target.value as RunMode)}
              >
                <option value="ws">WebSocket</option>
                <option value="tauri">Local Process</option>
              </FloureSelect>
            </SettingRow>
            {mode === "ws" && (
              <SettingRow label="Port">
                <FloureInput
                  type="number"
                  value={settings.wsPort}
                  onChange={(e) => setSettings((s) => ({ ...s, wsPort: Number(e.target.value) || 8765 }))}
                  maxWidth="max-w-[100px]"
                />
              </SettingRow>
            )}
          </ConfigSection>

          {/* Permissions */}
          <ConfigSection icon={ShieldCheck} title="Permissions" subtitle="System access for Floure">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-medium text-text-primary leading-tight">Clipboard</span>
                <span className="text-[11px] text-text-muted leading-tight mt-0.5">Copy transcripts to clipboard</span>
              </div>
              <FloureToggle
                checked={clipboardOn}
                onChange={(v) => {
                  setClipboardOn(v);
                  if (v) void requestClipboard();
                }}
              />
            </div>

            <div className="h-px bg-border" />

            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-medium text-text-primary leading-tight">Microphone</span>
                <span className="text-[11px] text-text-muted leading-tight mt-0.5">Capture audio for recognition</span>
              </div>
              <div className="flex items-center gap-2.5 flex-shrink-0">
                <FloureToggle
                  checked={micOn}
                  onChange={(v) => {
                    setMicOn(v);
                    if (v) {
                      void requestMic();
                    } else if (isCapturingMic) {
                      stopMic();
                    }
                  }}
                />
                {micOn && (
                  <button
                    onClick={isCapturingMic ? stopMic : () => void requestMic()}
                    className={`h-[28px] px-3 rounded-[8px] text-[11px] font-medium transition-colors ${
                      isCapturingMic
                        ? "bg-red-50 border border-red-200 text-red-600 hover:bg-red-100"
                        : "bg-app-surface-secondary border border-border text-text-secondary hover:bg-app-hover"
                    }`}
                  >
                    {isCapturingMic ? "Stop" : "Test"}
                  </button>
                )}
              </div>
            </div>
          </ConfigSection>

          {/* Speech */}
          <ConfigSection icon={Mic2} title="Speech Recognition" subtitle="ASR engine and model settings">
            <SettingRow label="Profile">
              <FloureSelect
                value={settings.asrProfile}
                onChange={(e) => setSettings((s) => ({ ...s, asrProfile: e.target.value as RuntimeSettings["asrProfile"] }))}
              >
                <option value="auto">Auto</option>
                <option value="speed">Speed</option>
                <option value="balanced">Balanced</option>
                <option value="accuracy">Accuracy</option>
                <option value="distil">Distil</option>
                <option value="turbo">Turbo</option>
              </FloureSelect>
            </SettingRow>
            <SettingRow label="Backend">
              <FloureSelect
                value={settings.backend}
                onChange={(e) => setSettings((s) => ({ ...s, backend: e.target.value as RuntimeSettings["backend"] }))}
              >
                <option value="auto">Auto</option>
                <option value="whisper_cpp">whisper.cpp</option>
                <option value="faster_whisper">faster-whisper</option>
              </FloureSelect>
            </SettingRow>
            <SettingRow label="Model">
              <FloureInput
                value={settings.model}
                onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
                placeholder="e.g. large-v3-turbo"
                maxWidth="max-w-[200px]"
              />
            </SettingRow>
            <SettingRow label="Language">
              <FloureSelect
                value={settings.language}
                onChange={(e) => setSettings((s) => ({ ...s, language: e.target.value }))}
                maxWidth="max-w-[160px]"
              >
                <option value="">Auto-detect</option>
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="pt">Portuguese</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="zh">Chinese</option>
                <option value="ar">Arabic</option>
                <option value="ru">Russian</option>
              </FloureSelect>
            </SettingRow>
            <SettingRow label="Vocabulary">
              <FloureInput
                value={settings.hotwords}
                onChange={(e) => setSettings((s) => ({ ...s, hotwords: e.target.value }))}
                placeholder="Comma-separated words"
                maxWidth="max-w-[240px]"
              />
            </SettingRow>
          </ConfigSection>

          {/* Output */}
          <ConfigSection icon={Sparkles} title="Output" subtitle="How transcribed text is delivered">
            <SettingRow label="LLM Mode">
              <FloureSelect
                value={settings.llmMode}
                onChange={(e) => setSettings((s) => ({ ...s, llmMode: e.target.value as RuntimeSettings["llmMode"] }))}
              >
                <option value="off">Off</option>
                <option value="cleanup">Cleanup</option>
                <option value="bullet_list">Bullet List</option>
                <option value="email">Email</option>
                <option value="commit_message">Commit Message</option>
              </FloureSelect>
            </SettingRow>

            <div className="h-px bg-border" />

            <FloureToggle
              checked={settings.fastCommit}
              onChange={(v) => setSettings((s) => ({ ...s, fastCommit: v }))}
              label="Fast Commit"
              description="Skip LLM for short transcriptions"
            />
            <FloureToggle
              checked={settings.typing}
              onChange={(v) => setSettings((s) => ({ ...s, typing: v }))}
              label="Type to Input"
              description="Automatically type into focused field"
            />
            <FloureToggle
              checked={settings.clipboard}
              onChange={(v) => setSettings((s) => ({ ...s, clipboard: v }))}
              label="Clipboard"
              description="Copy transcript to clipboard"
            />
            <FloureToggle
              checked={settings.debug}
              onChange={(v) => setSettings((s) => ({ ...s, debug: v }))}
              label="Debug Mode"
              description="Show raw engine output"
            />
          </ConfigSection>

          {/* LLM Provider */}
          <ConfigSection icon={Settings2} title="LLM Provider" subtitle="API keys and model selection for post-processing">
            <SettingRow label="Provider">
              <FloureSelect
                value={settings.llmProvider}
                onChange={(e) => setSettings((s) => ({ ...s, llmProvider: e.target.value as "deepseek" | "openrouter" }))}
                maxWidth="max-w-[140px]"
              >
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
              </FloureSelect>
            </SettingRow>
            <SettingRow label="Model">
              <FloureInput
                value={settings.llmModel}
                onChange={(e) => setSettings((s) => ({ ...s, llmModel: e.target.value }))}
                placeholder={settings.llmProvider === "deepseek" ? "deepseek-chat" : "openai/gpt-4o-mini"}
                maxWidth="max-w-[240px]"
              />
            </SettingRow>
            <SettingRow label="Fallback">
              <FloureInput
                value={settings.llmFallback}
                onChange={(e) => setSettings((s) => ({ ...s, llmFallback: e.target.value }))}
                placeholder={settings.llmProvider === "openrouter" ? "anthropic/claude-3-5-haiku-latest" : ""}
                maxWidth="max-w-[240px]"
              />
            </SettingRow>

            <div className="h-px bg-border" />

            <SettingRow label="DeepSeek Key">
              <FloureInput
                type="password"
                value={settings.deepseekApiKey}
                onChange={(e) => setSettings((s) => ({ ...s, deepseekApiKey: e.target.value }))}
                placeholder="sk-..."
                maxWidth="max-w-[240px]"
                className="font-mono text-[12px]"
              />
            </SettingRow>
            <SettingRow label="OpenRouter Key">
              <FloureInput
                type="password"
                value={settings.openrouterApiKey}
                onChange={(e) => setSettings((s) => ({ ...s, openrouterApiKey: e.target.value }))}
                placeholder="sk-or-..."
                maxWidth="max-w-[240px]"
                className="font-mono text-[12px]"
              />
            </SettingRow>
          </ConfigSection>

          {/* Diagnostics */}
          <ConfigSection icon={Activity} title="Diagnostics" subtitle="Engine command and runtime info">
            <div className="rounded-[10px] bg-app-surface-secondary border border-border px-3.5 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1.5 text-[11px] text-text-muted font-medium">
                  <Terminal size={11} />
                  Generated Command
                </span>
                <span className="text-[10px] text-text-disabled">
                  {mode === "ws" ? "restart backend to apply" : "applies on next start"}
                </span>
              </div>
              <code className="block text-[12px] text-accent-light font-mono leading-relaxed break-all">
                {commandPreview}
              </code>
            </div>
          </ConfigSection>
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
      } else {
        // Use REST API
        const resp = await fetch(`http://127.0.0.1:${settings.wsPort}/api/history?limit=${page * pageSize}`);
        if (resp.ok) {
          const rows = await resp.json();
          const items: TranscriptLine[] = rows.map((r: any) => ({
            id: r.id,
            raw: r.raw_text,
            processed: r.processed_text,
            status: "done",
            createdAt: r.created_at,
          }));
          setHistoryItems(items);
          setHasMoreHistory(rows.length >= page * pageSize);
        }
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
      if (validateSettings(settings)) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ ...settings, __version: SETTINGS_VERSION }));
      } else {
        console.error("Invalid settings, not saving to localStorage");
      }
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
      // Forward mic level to widget
      (async () => {
        try {
          const { emit } = await import("@tauri-apps/api/event");
          await emit("widget-mic-level", event.level);
        } catch { /* not in Tauri */ }
      })();
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
    if (event.type === "llm_partial") {
      const id = event.utterance_id;
      if (!id) return;
      setLines((prev) => prev.map((line) =>
        line.id === id ? { ...line, processed: event.text, status: "rewriting" } : line
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

  // --- Widget: emit status to widget window ---
  useEffect(() => {
    (async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("widget-status", status);
      } catch { /* not in Tauri */ }
    })();
  }, [status]);

  // --- Widget: listen for toggle and show-main events ---
  useEffect(() => {
    let unlistenToggle: (() => void) | undefined;
    let unlistenShowMain: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenToggle = await listen("widget-toggle", () => {
          if (connectedRef.current) stopRef.current();
          else void startRef.current();
        });
        unlistenShowMain = await listen("widget-show-main", async () => {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const win = getCurrentWindow();
            await win.unminimize();
            await win.show();
            await win.setFocus();
          } catch { /* not in Tauri */ }
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { unlistenToggle?.(); unlistenShowMain?.(); };
  }, []);

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
      // Register global shortcut Ctrl+Super for push-to-talk
      try {
        const { register } = await import("@tauri-apps/plugin-global-shortcut");
        await register("CommandOrControl+Super", (event) => {
          if (event.state === "Pressed") {
            if (!connectedRef.current) void startRef.current();
          } else if (event.state === "Released") {
            if (connectedRef.current) stopRef.current();
          }
        });
      } catch { /* not in Tauri or shortcut blocked */ }
    })();
    return () => { unlisten?.(); unlistenShortcut?.(); };
  }, []);

  const clearLines = () => setLines([]);

  const copyText = async (text: string, label: string) => {
    const { copyToClipboard } = await import("@/lib/clipboard");
    const ok = await copyToClipboard(text);
    if (ok) {
      setToast(label);
    } else {
      setToast("Copy failed");
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
      case "History":
        return <HistoryPage onBack={() => setActiveItem("Home")} />;
      case "Models":
        return <ModelsPage />;
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
