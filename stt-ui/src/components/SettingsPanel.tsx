import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { RuntimeSettings } from "../App";

interface Props {
  settings: RuntimeSettings;
  onSave: (s: RuntimeSettings) => void;
  visible: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ settings, onSave, visible, onClose }: Props) {
  const [local, setLocal] = useState<RuntimeSettings>({ ...settings });
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    setLocal({ ...settings });
  }, [settings]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && visible) {
      onClose();
    }
  }, [visible, onClose]);

  useEffect(() => {
    if (visible) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  if (!visible) return null;

  const update = (patch: Partial<RuntimeSettings>) => setLocal((s) => ({ ...s, ...patch }));

  const inputClass = cn(
    "w-full rounded-input bg-app-surface-secondary border border-border px-3 py-2 text-body text-text-primary",
    "placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 transition-colors",
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="bg-app-surface rounded-card border border-border w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-heading text-text-primary">⚙ Settings</h2>
          <button
            className={cn(
              "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
              "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
            )}
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕ Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary">🤖 LLM Provider</h3>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-provider" className="text-label text-text-secondary">Provider</label>
              <select
                id="settings-provider"
                className={inputClass}
                value={local.llmProvider}
                onChange={(e) => update({ llmProvider: e.target.value as "deepseek" | "openrouter" })}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-model" className="text-label text-text-secondary">Model</label>
              <input
                id="settings-model"
                className={inputClass}
                value={local.llmModel}
                onChange={(e) => update({ llmModel: e.target.value })}
                placeholder={local.llmProvider === "deepseek" ? "deepseek-chat" : "openai/gpt-4o-mini"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-fallback" className="text-label text-text-secondary">Fallback Model</label>
              <input
                id="settings-fallback"
                className={inputClass}
                value={local.llmFallback}
                onChange={(e) => update({ llmFallback: e.target.value })}
                placeholder={local.llmProvider === "openrouter" ? "anthropic/claude-3-5-haiku-latest" : ""}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary">🔑 API Keys</h3>
            <p className="text-small text-text-muted">Keys are passed directly to the engine process and never stored.</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-deepseek-key" className="text-label text-text-secondary">DeepSeek API Key</label>
              <input
                id="settings-deepseek-key"
                className={cn(inputClass, "font-mono")}
                type={showKeys ? "text" : "password"}
                value={local.deepseekApiKey}
                onChange={(e) => update({ deepseekApiKey: e.target.value })}
                placeholder={local.deepseekApiKey ? "••••••••" : "sk-..."}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="settings-openrouter-key" className="text-label text-text-secondary">OpenRouter API Key</label>
              <input
                id="settings-openrouter-key"
                className={cn(inputClass, "font-mono")}
                type={showKeys ? "text" : "password"}
                value={local.openrouterApiKey}
                onChange={(e) => update({ openrouterApiKey: e.target.value })}
                placeholder={local.openrouterApiKey ? "••••••••" : "sk-or-..."}
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

          <div className="flex flex-col gap-3">
            <h3 className="text-subheading text-text-primary">🎤 Speech Recognition</h3>
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
                className={inputClass}
                value={local.hotwords}
                onChange={(e) => update({ hotwords: e.target.value })}
                placeholder="e.g. WhisperFlow, Tauri, PyTorch"
              />
              <p className="text-small text-text-muted">Comma-separated words to boost recognition accuracy.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end px-6 py-4 border-t border-border">
          <button
            className={cn(
              "inline-flex items-center justify-center rounded-button h-11 px-4 py-2 text-body font-medium transition-all duration-200",
              "bg-accent text-white hover:bg-accent-warm shadow-accent-button",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            onClick={() => { onSave(local); onClose(); }}
          >
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
}
