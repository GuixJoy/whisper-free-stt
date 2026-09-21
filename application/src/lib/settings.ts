// ── Settings domain: types, defaults, validation, persistence, wire shape ──
//
// Deliberately React-free so it can be unit tested directly and imported by
// both `useSettings` (the owner) and the components that render it.

import { z } from "zod";

export type RunMode = "ws" | "tauri";

export interface RuntimeSettings {
  wsPort: number;
  asrProfile: "parakeet" | "whisper-turbo" | "whisper-base";
  llmMode: "cleanup" | "off" | "bullet_list" | "email" | "commit_message";
  llmProvider: "local" | "openrouter";
  llmModel: string;
  openrouterApiKey: string;
  typing: boolean;
  clipboard: boolean;
  hotwords: string;
  language: string;
}

/// Model id used when the UI has no explicit selection. Mirrors the backend's
/// `default_llm_model`; an empty id must never reach the backend because it
/// resolves to a non-existent path (`models/""/file.gguf`).
export const DEFAULT_LLM_MODEL = "s1-mini-q4_k_m";

export const DEFAULT_SETTINGS: RuntimeSettings = {
  wsPort: 8765,
  asrProfile: "parakeet",
  llmMode: "cleanup",
  llmProvider: "local",
  llmModel: "",
  openrouterApiKey: "",
  typing: true,
  clipboard: true,
  hotwords: "",
  language: "",
};

export const LOCAL_STORAGE_KEY = "stt-settings";
export const SETTINGS_VERSION = 2;

const SettingsSchema = z.object({
  wsPort: z.number().int().min(1).max(65535),
  asrProfile: z.enum(["parakeet", "whisper-turbo", "whisper-base"]),
  llmMode: z.enum(["cleanup", "off", "bullet_list", "email", "commit_message"]),
  llmProvider: z.enum(["local", "openrouter"]),
  llmModel: z.string().max(100),
  // API keys are session-only: never persisted (see persistableSettings).
  openrouterApiKey: z.string().max(200).default(""),
  typing: z.boolean(),
  clipboard: z.boolean(),
  hotwords: z.string().max(200),
  language: z.string().max(10),
});

export function validateSettings(settings: unknown): settings is RuntimeSettings {
  return SettingsSchema.safeParse(settings).success;
}

export function getInitialSettings(): RuntimeSettings {
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

/// The persisted shape: API keys are stripped so localStorage never holds
/// secrets.
export function persistableSettings(s: RuntimeSettings) {
  const { openrouterApiKey: _key, ...persisted } = s;
  void _key;
  return { ...persisted, __version: SETTINGS_VERSION };
}

/** Backend wire shape for `set_floure_config` (snake_case, UI-owned fields only).
 *  `hotwords` stays out until the P1 decode path exists.
 *
 *  This is the single chokepoint between UI state and the Rust config, so the
 *  "never send an invalid payload" rule lives here: blank values that would
 *  resolve to a broken path or an empty enum are normalised, never dropped —
 *  dropping the sync would silently leave the backend on a stale config. */
export function toBackendSettings(s: RuntimeSettings) {
  return {
    asr_profile: s.asrProfile,
    language: s.language.trim() || "en",
    llm_provider: s.llmProvider,
    llm_mode: s.llmMode,
    // An empty id resolves to models/""/file.gguf, so a downloaded model
    // reports "Local LLM model not loaded".
    llm_model: s.llmModel.trim() || DEFAULT_LLM_MODEL,
    typing_enabled: s.typing,
    clipboard_enabled: s.clipboard,
  };
}
