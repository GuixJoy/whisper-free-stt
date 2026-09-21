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
import { isTauri } from "../lib/utils";

export interface UseSettings {
  settings: RuntimeSettings;
  setSettings: React.Dispatch<React.SetStateAction<RuntimeSettings>>;
  /** Shallow-merge a patch — the common case, and it keeps the invariant. */
  updateSettings: (patch: Partial<RuntimeSettings>) => void;
  /**
   * Set when the last backend push failed. The backend keeps running with the
   * previous config in that case, so the caller should surface it rather than
   * let the settings silently not apply.
   */
  syncError: string | null;
}

export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<RuntimeSettings>(getInitialSettings);
  const [syncError, setSyncError] = useState<string | null>(null);

  const updateSettings = useCallback((patch: Partial<RuntimeSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  useEffect(() => {
    // Push to the native backend. The API key is session-only in memory; an
    // empty key clears the backend slot.
    const push = async () => {
      // Not Tauri (browser dev): there is no backend to configure. This is the
      // only case where doing nothing is correct.
      if (!isTauri()) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("set_floure_config", { update: toBackendSettings(settings) });
        await invoke("set_openrouter_api_key", { key: settings.openrouterApiKey.trim() });
        setSyncError(null);
      } catch (e) {
        // A real failure leaves the backend on a stale config. Previously this
        // was swallowed identically to web mode, so settings could silently
        // fail to apply.
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[settings] backend sync failed", e);
        setSyncError(msg);
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

  return { settings, setSettings, updateSettings, syncError };
}
