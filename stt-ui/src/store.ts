// ── Global state store (Zustand-lite pattern with React Context) ──
import { createContext, useContext } from "react";

export interface ModelInfo {
  name: string;
  size: string;
  sizeBytes: number;
  speed: string;
  accuracy: string;
  bestFor: string;
  backend: "whisper_cpp" | "faster_whisper";
  profile: "speed" | "balanced" | "accuracy" | "distil" | "turbo";
  downloaded: boolean;
  recommended: boolean;
}

export const MODEL_CATALOG: ModelInfo[] = [
  {
    name: "tiny.en", size: "~75 MB", sizeBytes: 75_000_000, speed: "🚀 Fastest", accuracy: "⭐",
    bestFor: "Quick notes, fast responses", backend: "whisper_cpp", profile: "speed",
    downloaded: false, recommended: true,
  },
  {
    name: "base.en", size: "~145 MB", sizeBytes: 145_000_000, speed: "🚀 Fast", accuracy: "⭐⭐",
    bestFor: "Daily dictation", backend: "whisper_cpp", profile: "balanced",
    downloaded: false, recommended: false,
  },
  {
    name: "small.en", size: "~465 MB", sizeBytes: 465_000_000, speed: "⚡ Medium", accuracy: "⭐⭐⭐",
    bestFor: "Professional use", backend: "whisper_cpp", profile: "accuracy",
    downloaded: false, recommended: true,
  },
  {
    name: "distil-large-v3", size: "~1.5 GB", sizeBytes: 1_500_000_000, speed: "🐢 Slower", accuracy: "⭐⭐⭐⭐",
    bestFor: "High accuracy (GPU recommended)", backend: "faster_whisper", profile: "distil",
    downloaded: false, recommended: false,
  },
  {
    name: "large-v3-turbo", size: "~3 GB", sizeBytes: 3_000_000_000, speed: "🐢 Slow", accuracy: "⭐⭐⭐⭐⭐",
    bestFor: "Maximum accuracy (GPU required)", backend: "faster_whisper", profile: "turbo",
    downloaded: false, recommended: false,
  },
];

export interface SystemCheck {
  name: string;
  status: "pass" | "fail" | "pending" | "warning";
  message: string;
  fixHint?: string;
}

export interface OnboardingState {
  step: number;
  totalSteps: number;
  completed: boolean;
  skipped: boolean;
  systemChecks: SystemCheck[];
  selectedMicIndex: number | null;
  micLevel: number;
  clipboardEnabled: boolean;
  typingEnabled: boolean;
  preferredModel: string;
  modelDownloadProgress: Record<string, { percent: number; bytesDownloaded: number; bytesTotal: number; status: "idle" | "downloading" | "done" | "error" }>;
  error: string | null;
}

export type OnboardingAction =
  | { type: "SET_STEP"; step: number }
  | { type: "NEXT_STEP" }
  | { type: "SET_SYSTEM_CHECKS"; checks: SystemCheck[] }
  | { type: "SET_COMPLETED" }
  | { type: "SET_SKIPPED" }
  | { type: "SET_MIC"; index: number | null; level: number }
  | { type: "SET_CLIPBOARD"; enabled: boolean }
  | { type: "SET_TYPING"; enabled: boolean }
  | { type: "SET_MODEL"; name: string }
  | { type: "SET_DOWNLOAD_PROGRESS"; name: string; percent: number; bytesDownloaded: number; bytesTotal: number; status: "idle" | "downloading" | "done" | "error" }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" };

export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "NEXT_STEP":
      return { ...state, step: Math.min(state.step + 1, state.totalSteps) };
    case "SET_SYSTEM_CHECKS":
      return { ...state, systemChecks: action.checks };
    case "SET_COMPLETED":
      return { ...state, completed: true };
    case "SET_SKIPPED":
      return { ...state, skipped: true, completed: true };
    case "SET_MIC":
      return { ...state, selectedMicIndex: action.index, micLevel: action.level };
    case "SET_CLIPBOARD":
      return { ...state, clipboardEnabled: action.enabled };
    case "SET_TYPING":
      return { ...state, typingEnabled: action.enabled };
    case "SET_MODEL":
      return { ...state, preferredModel: action.name };
    case "SET_DOWNLOAD_PROGRESS":
      return {
        ...state,
        modelDownloadProgress: {
          ...state.modelDownloadProgress,
          [action.name]: {
            percent: action.percent,
            bytesDownloaded: action.bytesDownloaded,
            bytesTotal: action.bytesTotal,
            status: action.status,
          },
        },
      };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
}

export const DEFAULT_ONBOARDING: OnboardingState = {
  step: 0,
  totalSteps: 5,
  completed: false,
  skipped: false,
  systemChecks: [],
  selectedMicIndex: null,
  micLevel: 0,
  clipboardEnabled: false,
  typingEnabled: false,
  preferredModel: "small.en",
  modelDownloadProgress: {},
  error: null,
};

export type AppView = "onboarding" | "main";

export const AppStateContext = createContext<{
  onboarding: OnboardingState;
  onboardingDispatch: React.Dispatch<OnboardingAction>;
  view: AppView;
  setView: (v: AppView) => void;
} | null>(null);

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
