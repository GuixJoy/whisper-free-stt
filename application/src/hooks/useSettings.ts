// ── Settings ownership: state, persistence, and the backend sync ──
//
// Extracted from App.tsx, which held this alongside 21 other hooks. The point
// of the hook is that there is exactly ONE place that:
//   1. owns the settings object,
//   2. writes it to localStorage (minus secrets), and
//   3. pushes it to the Rust backend.
// Anything that needs to change settings goes through `setSettings` here, so
// the "never send an invalid payload" rule (toBackendSettings) cannot be
// bypassed by a second call site.

import { useCallback, useEffect, useState } from "react";
import {
  LOCAL_STORAGE_KEY,
  getInitialSettings,
  persistableSettings,
  toBackendSettings,
  validateSettings,
  type RuntimeSettings,
} from "../lib/settings";

export interface UseSettings {
  settings: RuntimeSettings;
  setSettings: React.Dispatch<React.SetStateAction<RuntimeSettings>>;
  /** Shallow-merge a patch — the common case, and it keeps the invariant. */
  updateSettings: (patch: Partial<RuntimeSettings>) => void;
}

export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<RuntimeSettings>(getInitialSettings);

  const updateSettings = useCallback((patch: Partial<RuntimeSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  useEffect(() => {
    // Push to the native backend (no-op outside Tauri). The API key is
    // session-only in memory; an empty key clears the backend slot.
    const push = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_floure_config", { update: toBackendSettings(settings) });
        await invoke("set_openrouter_api_key", { key: settings.openrouterApiKey.trim() });
      } catch {
        // Web mode: no Tauri backend to configure.
      }
    };
    void push();

    try {
      const persisted = persistableSettings(settings);
      if (validateSettings({ ...persisted, openrouterApiKey: "" })) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(persisted));
      } else {
        console.error("Invalid settings, not saving to localStorage");
      }
    } catch (e) {
      console.error("Failed to save settings", e);
    }
  }, [settings]);

  return { settings, setSettings, updateSettings };
}
