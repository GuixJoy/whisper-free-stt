import { useState, useEffect, useCallback } from "react";
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

  // Reset local state when settings change
  useEffect(() => {
    setLocal({ ...settings });
  }, [settings]);

  // Keyboard handler: Escape to close
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

  return (
    <div
      className="settings-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div className="settings-panel">
        <div className="settings-header">
          <h2>⚙ Settings</h2>
          <button
            className="sketch-btn btn-sm"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕ Close
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-section">
            <h3>🤖 LLM Provider</h3>
            <div className="controls-row">
              <label htmlFor="settings-provider">Provider</label>
              <select
                id="settings-provider"
                className="sketch-input"
                value={local.llmProvider}
                onChange={(e) => update({ llmProvider: e.target.value as "deepseek" | "openrouter" })}
              >
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </div>
            <div className="controls-row">
              <label htmlFor="settings-model">Model</label>
              <input
                id="settings-model"
                className="sketch-input"
                value={local.llmModel}
                onChange={(e) => update({ llmModel: e.target.value })}
                placeholder={local.llmProvider === "deepseek" ? "deepseek-chat" : "openai/gpt-4o-mini"}
              />
            </div>
            <div className="controls-row">
              <label htmlFor="settings-fallback">Fallback Model</label>
              <input
                id="settings-fallback"
                className="sketch-input"
                value={local.llmFallback}
                onChange={(e) => update({ llmFallback: e.target.value })}
                placeholder={local.llmProvider === "openrouter" ? "anthropic/claude-3-5-haiku-latest" : ""}
              />
            </div>
          </div>

          <div className="settings-section">
            <h3>🔑 API Keys</h3>
            <p className="settings-hint">Keys are passed directly to the engine process and never stored.</p>
            <div className="controls-row">
              <label htmlFor="settings-deepseek-key">DeepSeek API Key</label>
              <input
                id="settings-deepseek-key"
                className="sketch-input mono"
                type={showKeys ? "text" : "password"}
                value={local.deepseekApiKey}
                onChange={(e) => update({ deepseekApiKey: e.target.value })}
                placeholder={local.deepseekApiKey ? "••••••••" : "sk-..."}
                autoComplete="off"
              />
            </div>
            <div className="controls-row">
              <label htmlFor="settings-openrouter-key">OpenRouter API Key</label>
              <input
                id="settings-openrouter-key"
                className="sketch-input mono"
                type={showKeys ? "text" : "password"}
                value={local.openrouterApiKey}
                onChange={(e) => update({ openrouterApiKey: e.target.value })}
                placeholder={local.openrouterApiKey ? "••••••••" : "sk-or-..."}
                autoComplete="off"
              />
            </div>
            <label className="toggle-label">
              <span className="toggle-wrap">
                <input
                  type="checkbox"
                  checked={showKeys}
                  onChange={(e) => setShowKeys(e.target.checked)}
                  aria-label="Show API keys"
                />
                <span className="toggle-track" />
              </span>
              Show keys
            </label>
          </div>
        </div>
        <div className="settings-actions">
          <button
            className="sketch-btn btn-start"
            onClick={() => { onSave(local); onClose(); }}
          >
            Save & Apply
          </button>
        </div>
      </div>
    </div>
  );
}
