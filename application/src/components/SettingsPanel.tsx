import { useState, useEffect } from "react";
import { Settings, X, Bot, KeyRound, Mic, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import Dialog from "./Dialog";
import type { RuntimeSettings } from "../lib/settings";

interface Props {
  settings: RuntimeSettings;
  onSave: (s: RuntimeSettings) => void;
  visible: boolean;
  onClose: () => void;
}

const HOTKEY_OPTIONS = [
  { value: "CommandOrControl+Shift+Space", label: "Ctrl + Shift + Space" },
  { value: "CommandOrControl+Alt+Space", label: "Ctrl + Alt + Space" },
  { value: "Alt+Space", label: "Alt + Space" },
  { value: "Super+Space", label: "Super + Space" },
  { value: "CommandOrControl+Shift+K", label: "Ctrl + Shift + K" },
];

const TOGGLES = [
  { key: "typing", label: "Type to Input", hint: "Automatically type into focused field" },
  { key: "clipboard", label: "Clipboard", hint: "Copy transcript to clipboard" },
] as const;

export default function SettingsPanel({ settings, onSave, visible, onClose }: Props) {
  const [local, setLocal] = useState<RuntimeSettings>({ ...settings });
  const [showKeys, setShowKeys] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [hotkey, setHotkey] = useState(() => localStorage.getItem("stt-hotkey") || "CommandOrControl+Shift+Space");
  const { permissions, requestClipboard, requestMic, isCapturingMic, stopMic } = usePermissions();

  useEffect(() => {
    setLocal({ ...settings });
  }, [settings]);

  useEffect(() => {
    if (visible) {
      setHotkey(localStorage.getItem("stt-hotkey") || "CommandOrControl+Shift+Space");
      setConfirmDiscard(false);
    }
  }, [visible]);

  if (!visible) return null;

  // Closing discards edits with no undo, so the first Close asks and the
  // second one commits — same "confirm a discard" contract as a beforeunload
  // guard, without nesting a dialog inside this one.
  const dirty = JSON.stringify(local) !== JSON.stringify(settings);
  const handleClose = () => {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setConfirmDiscard(false);
    onClose();
  };

  const update = (patch: Partial<RuntimeSettings>) => setLocal((s) => ({ ...s, ...patch }));

  const inputClass = cn(
    "w-full rounded-input bg-app-surface-secondary border border-border px-3 py-2 text-body text-text-primary",
    "placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/30 transition-colors",
  );

  const checkRow = "flex items-center justify-between gap-3";
  const checkLabel = "text-body text-text-primary";
  const checkHint = "text-small text-text-muted";

  return (
    <Dialog
      onClose={handleClose}
      label="Settings"
      className="max-w-lg max-h-[85vh] flex flex-col overflow-hidden bg-app-surface"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-balance text-heading text-text-primary flex items-center gap-2"><Settings size={18} className="text-text-secondary" />Settings</h2>
          <button
            className={cn(
              "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-colors duration-200",
              "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
            )}
            onClick={handleClose}
            aria-label={confirmDiscard ? "Discard settings changes" : "Close settings"}
          >
            <X size={14} /> {confirmDiscard ? "Discard?" : "Close"}
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain px-6 py-4 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary flex items-center gap-2"><Mic size={15} className="text-text-secondary" />Speech Recognition</h3>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-asr-profile" className="text-label text-text-secondary">Profile</label>
              <select
                id="settings-asr-profile"
                className={inputClass}
                value={local.asrProfile}
                onChange={(e) => update({ asrProfile: e.target.value as RuntimeSettings["asrProfile"] })}
              >
                <option value="parakeet">Parakeet TDT (English)</option>
                <option value="whisper-turbo">Whisper large-v3-turbo (Multilingual)</option>
                <option value="whisper-base">Whisper base (Lightweight)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-language" className="text-label text-text-secondary">Language</label>
              <select
                id="settings-language"
                className={inputClass}
                value={local.language}
                onChange={(e) => update({ language: e.target.value })}
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
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-hotwords" className="text-label text-text-secondary">Custom Vocabulary</label>
              <input
                id="settings-hotwords"
                name="hotwords"
                autoComplete="off"
                className={inputClass}
                value={local.hotwords}
                onChange={(e) => update({ hotwords: e.target.value })}
                placeholder="e.g. WhisperFlow, Tauri, PyTorch"
              />
              <p className="text-small text-text-muted">Comma-separated words to boost recognition accuracy.</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary flex items-center gap-2"><SlidersHorizontal size={15} className="text-text-secondary" />Output</h3>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-llm-mode" className="text-label text-text-secondary">LLM Mode</label>
              <select
                id="settings-llm-mode"
                className={inputClass}
                value={local.llmMode}
                onChange={(e) => update({ llmMode: e.target.value as RuntimeSettings["llmMode"] })}
              >
                <option value="off">Off</option>
                <option value="cleanup">Cleanup</option>
                <option value="bullet_list">Bullet List</option>
                <option value="email">Email</option>
                <option value="commit_message">Commit Message</option>
              </select>
            </div>
            {TOGGLES.map((t) => (
              <label key={t.key} className={checkRow}>
                <span>
                  <span className={checkLabel}>{t.label}</span>
                  <span className={checkHint}> — {t.hint}</span>
                </span>
                <input
                  type="checkbox"
                  checked={local[t.key]}
                  onChange={(e) => update({ [t.key]: e.target.checked })}
                  aria-label={t.label}
                  className="h-5 w-5 accent-[#FF3B56]"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary flex items-center gap-2"><Bot size={15} className="text-text-secondary" />LLM Provider</h3>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-provider" className="text-label text-text-secondary">Provider</label>
              <select
                id="settings-provider"
                className={inputClass}
                value={local.llmProvider}
                onChange={(e) => update({ llmProvider: e.target.value as RuntimeSettings["llmProvider"] })}
              >
                <option value="local">Local</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>
            {local.llmProvider === "local" ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-local-model" className="text-label text-text-secondary">Model</label>
                <select
                  id="settings-local-model"
                  className={inputClass}
                  value={local.llmModel || "s1-mini-q4_k_m"}
                  onChange={(e) => update({ llmModel: e.target.value })}
                >
                  <option value="s1-mini-q4_k_m">S1-Mini (462 MB)</option>
                  <option value="gemma-3-1b-it-q4_k_m">Gemma 3 1B (806 MB)</option>
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-model" className="text-label text-text-secondary">Model</label>
                <input
                  id="settings-model"
                  name="llm-model"
                  autoComplete="off"
                  spellCheck={false}
                  className={inputClass}
                  value={local.llmModel}
                  onChange={(e) => update({ llmModel: e.target.value })}
                  placeholder="openai/gpt-4o-mini"
                />
              </div>
            )}
          </div>

          {local.llmProvider !== "local" && (
            <div className="flex flex-col gap-3">
              <h3 className="text-subheading text-text-primary flex items-center gap-2"><KeyRound size={15} className="text-text-secondary" />API Keys</h3>
              <p className="text-small text-text-muted">Keys stay in memory only and are never written to disk — re-enter them after a restart.</p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="settings-openrouter-key" className="text-label text-text-secondary">OpenRouter API Key</label>
                <input
                  id="settings-openrouter-key"
                  name="openrouter-api-key"
                  spellCheck={false}
                  className={cn(inputClass, "font-mono")}
                  type={showKeys ? "text" : "password"}
                  value={local.openrouterApiKey}
                  onChange={(e) => update({ openrouterApiKey: e.target.value })}
                  placeholder={local.openrouterApiKey ? "••••••••" : "sk-or-…"}
                  autoComplete="off"
                />
              </div>
              <label className="flex items-center gap-2 text-body text-text-secondary cursor-pointer">
                <span className="relative inline-flex h-5 w-9 items-center rounded-full bg-app-surface-secondary border border-border transition-colors">
                  <input
                    type="checkbox"
                    checked={showKeys}
                    onChange={(e) => setShowKeys(e.target.checked)}
                    aria-label="Show API keys"
                    className="sr-only peer"
                  />
                  <span className="inline-block h-3.5 w-3.5 rounded-full bg-text-muted transition-transform peer-checked:translate-x-4 peer-checked:bg-accent ml-0.5" />
                </span>
              Show keys
            </label>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary flex items-center gap-2"><Mic size={15} className="text-text-secondary" />Push-to-Talk</h3>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-hotkey" className="text-label text-text-secondary">Push-to-Talk Hotkey</label>
              <select
                id="settings-hotkey"
                className={inputClass}
                value={hotkey}
                onChange={(e) => setHotkey(e.target.value)}
              >
                {HOTKEY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-small text-text-muted">Hold to record, release to commit text.</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary flex items-center gap-2"><ShieldCheck size={15} className="text-text-secondary" />Permissions</h3>
            <label className={checkRow}>
              <span>
                <span className={checkLabel}>Clipboard</span>
                <span className={checkHint}> — copy transcripts to clipboard</span>
              </span>
              <input
                type="checkbox"
                checked={permissions.clipboard === "granted"}
                onChange={(e) => { if (e.target.checked) void requestClipboard(); }}
                aria-label="Clipboard permission"
                className="h-5 w-5 accent-[#FF3B56]"
              />
            </label>
            <div className={checkRow}>
              <span>
                <span className={checkLabel}>Microphone</span>
                <span className={checkHint}> — capture audio for recognition</span>
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={permissions.microphone === "granted"}
                  onChange={(e) => {
                    if (e.target.checked) void requestMic();
                    else if (isCapturingMic) stopMic();
                  }}
                  aria-label="Microphone permission"
                  className="h-5 w-5 accent-[#FF3B56]"
                />
                {permissions.microphone === "granted" && (
                  <button
                    onClick={isCapturingMic ? stopMic : () => void requestMic()}
                    className="h-[26px] px-2.5 rounded-[6px] text-[11px] font-medium bg-app-surface-secondary border border-border text-text-secondary hover:bg-app-hover transition-colors"
                  >
                    {isCapturingMic ? "Stop" : "Test"}
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end px-6 py-4 border-t border-border">
          <button
            className={cn(
              "inline-flex items-center justify-center rounded-button h-11 px-4 py-2 text-body font-medium transition-colors duration-200",
              "bg-accent text-white hover:bg-accent-warm shadow-accent-button",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            onClick={() => { localStorage.setItem("stt-hotkey", hotkey); onSave(local); onClose(); }}
          >
            Save & Apply
          </button>
        </div>
    </Dialog>
  );
}
