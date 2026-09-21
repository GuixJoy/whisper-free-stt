import { useEffect, useRef, useState, useCallback } from "react";
import type { STTApi, STTEvent } from "./api";
import { createTauriApi } from "./api-tauri";
import OnboardingWizard from "./components/OnboardingWizard";
import MicPermissionModal from "./components/MicPermissionModal";
import PttOverlay from "./components/PttOverlay";
import ErrorBanner from "./components/ErrorBanner";
import type { AppError } from "./components/ErrorBanner";
import HistoryPage from "./components/HistoryPage";
import SettingsPanel from "./components/SettingsPanel";
import InsightsPage from "./components/InsightsPage";
import DictionaryPage from "./components/DictionaryPage";
import ModelsPage from "./components/ModelsPage";
import { AppShell } from "./layouts/AppShell";
import { type AppView } from "./store";
import { micLevelEmitter } from "./utils/mic-emitter";
import { useSettings } from "./hooks/useSettings";
import { type RuntimeSettings } from "./lib/settings";
import { FeedView, type TranscriptLine } from "./views/FeedView";
import { categoryForKind } from "./lib/errors";

function App() {
  const [connected, setConnected] = useState(false);
  const { settings, setSettings, syncError } = useSettings();
  const [status, setStatus] = useState("idle");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [toast, setToast] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [showMicModal, setShowMicModal] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [resolvedModel, setResolvedModel] = useState<{ profile: string; model: string; backend: string; device: string } | null>(null);
  const [view, setView] = useState<AppView>(
    localStorage.getItem("onboarding_completed") === "true" ? "main" : "onboarding"
  );
  const [errors, setErrors] = useState<AppError[]>([]);
  const [activeItem, setActiveItem] = useState("Home");
  const [historyItems, setHistoryItems] = useState<TranscriptLine[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);

  const runtimeRef = useRef<STTApi | null>(null);
  // Bumped on every (re)spawn. Async callbacks from a previous generation must
  // not touch the current engine: a stale spawn().catch() used to set
  // runtimeRef to null and clobber the live handle.
  const engineGenerationRef = useRef(0);
  const nextLocalId = useRef(1);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const connectedRef = useRef(connected);
  const statusRef = useRef(status);
  const lastWidgetMicEmit = useRef(0);
  const isStartingRef = useRef(false);
  const startRef = useRef<(overrideSettings?: RuntimeSettings, source?: string) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [hotkey] = useState(() => localStorage.getItem("stt-hotkey") || "CommandOrControl+Shift+Space");


  connectedRef.current = connected;
  statusRef.current = status;

  // --- Engine lifecycle: spawn once on mount, keep alive permanently ---
  useEffect(() => {
    // StrictMode guard: prevent double-spawn in development
    if (runtimeRef.current) return;

    const generation = ++engineGenerationRef.current;
    const api: STTApi = createTauriApi();

    api.onEvent(applyEvent);
    runtimeRef.current = api;

    // Spawn backend — loads models, warms ASR, stays idle until PTT
    api.spawn().then(() => {
      if (engineGenerationRef.current !== generation) return;
      console.log("[Engine] Backend ready — waiting for PTT hotkey");
    }).catch((err) => {
      // Ignore failures from a superseded engine: a settings change respawns,
      // and this callback must not clear the newer handle.
      if (engineGenerationRef.current !== generation) return;
      const msg = err instanceof Error ? err.message : "Failed to start engine";
      setToast(msg);
      addError("connection", msg, true, "Check if stt-engine is installed");
      runtimeRef.current = null;
    });

    // Cleanup: kill backend on app unmount or respawn
    return () => {
      api.kill();
      // Only clear if we still own the ref — a newer generation may have
      // already replaced it.
      if (runtimeRef.current === api) runtimeRef.current = null;
    };
  }, [settingsVersion]); // Re-spawn when settings are saved

  // Load history from backend
  const fetchHistory = useCallback(async (page: number, pageSize: number = 200) => {
    setHistoryLoading(true);
    try {
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
    } catch {
      setHasMoreHistory(false);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

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
        const prefix = status === "idle" ? "[·]" : status === "listening" ? "[rec]" : status === "transcribing" ? "[tx]" : "[on]";
        await win.setTitle(`${prefix} STT — ${status}`);
      } catch { /* not in Tauri */ }
    })();
  }, [status]);

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
        else startRef.current(undefined, "SpaceBar");
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

  // A failed settings push leaves the engine on the previous config; surface
  // it instead of letting the change silently not apply. The banner category
  // comes from the Rust error variant, not from a hardcoded guess.
  useEffect(() => {
    if (syncError) {
      addError(
        categoryForKind(syncError.kind),
        `Settings did not reach the engine: ${syncError.message}`,
      );
    }
  }, [syncError, addError]);

  const applyEvent = (event: STTEvent) => {
    if (event.type === "error") {
      addError(event.category, event.message);
      return;
    }
    if (event.type === "state") {
      setStatus(event.state);
      if (event.state === "error" && event.message) {
        addError("model", event.message);
      }
      return;
    }
    if (event.type === "mic") {
      micLevelEmitter.emit(event.level);
      // ponytail: throttle Tauri bridge to ~15fps; full-rate stays local via micLevelEmitter.
      const now = Date.now();
      if (now - lastWidgetMicEmit.current >= 66) {
        lastWidgetMicEmit.current = now;
        const level = event.level;
        (async () => {
          try {
            const { emit } = await import("@tauri-apps/api/event");
            await emit("widget-mic-level", level);
          } catch { /* not in Tauri */ }
        })();
      }
      return;
    }
    if (event.type === "asr_ready") {
      setResolvedModel({ profile: "parakeet", model: "Parakeet TDT", backend: event.backend, device: "cuda" });
      setToast("Engine ready — models loaded");
      return;
    }
    if (event.type === "asr_partial") {
      setStatus("transcribing");
      const id = nextLocalId.current;
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.status === "transcribing") {
          return [...prev.slice(0, -1), { ...last, raw: event.text }];
        }
        return [...prev, { id, raw: event.text, processed: "", status: "transcribing", createdAt: new Date().toISOString() }].slice(-500);
      });
      return;
    }
    if (event.type === "asr_final") {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.status === "transcribing") {
          return [...prev.slice(0, -1), { ...last, raw: event.text, processed: event.text, status: "transcribing", createdAt: last.createdAt }];
        }
        return [...prev, { id: nextLocalId.current++, raw: event.text, processed: event.text, status: "transcribing", createdAt: new Date().toISOString() }].slice(-500);
      });
      return;
    }
    if (event.type === "llm_start") {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last) {
          return [...prev.slice(0, -1), { ...last, status: "rewriting" }];
        }
        return prev;
      });
      return;
    }
    if (event.type === "llm_token") {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last) {
          const updatedProcessed = (last.processed || "") + event.text;
          return [...prev.slice(0, -1), { ...last, processed: updatedProcessed, status: "rewriting" }];
        }
        return prev;
      });
      return;
    }
    if (event.type === "llm_end") {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last) {
          return [...prev.slice(0, -1), { ...last, processed: event.text, status: "done" }];
        }
        return prev;
      });
      return;
    }
  };

  const dismissErrorsOfCategory = (category: AppError["category"]) => {
    setErrors((prev) => prev.map((e) => (e.category === category ? { ...e, dismissed: true } : e)));
  };

  // --- PTT lifecycle: send commands to running backend ---
  const start = async (_overrideSettings?: RuntimeSettings, source: string = "Unknown") => {
    if (connected || isStartingRef.current) {
      console.log(`[PTT] Start rejected — already recording, source=${source}`);
      return;
    }
    isStartingRef.current = true;
    if (!runtimeRef.current) {
      console.log(`[PTT] Start rejected — engine not ready, source=${source}`);
      isStartingRef.current = false;
      setToast("Engine not ready — wait a moment and try again");
      return;
    }
    // Backend handles typing directly — no need for frontend focus restore
    console.log(`[PTT] Start requested — source=${source}`);
    runtimeRef.current.start(); // Sends start_recording to backend
    setConnected(true);
    setPttActive(true);
    dismissErrorsOfCategory("connection");
  };

  const stop = async () => {
    if (!runtimeRef.current) return;
    isStartingRef.current = false;
    // Backend handles typing directly — no need for frontend type_text
    console.log("[PTT] Stop requested");
    runtimeRef.current.stop(); // Sends stop_recording to backend
    setConnected(false);
    setStatus("idle");
    setPttActive(false);
    micLevelEmitter.emit(0);
  };

  startRef.current = start;
  stopRef.current = stop;

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
    let unlistenReady: (() => void) | undefined;
    (async () => {
      try {
        const { listen, emit } = await import("@tauri-apps/api/event");
        unlistenToggle = await listen("widget-toggle", () => {
          if (connectedRef.current) stopRef.current();
          else startRef.current(undefined, "Widget");
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
        // Widget opened late misses earlier status broadcasts — resend on handshake.
        unlistenReady = await listen("widget-ready", async () => {
          try {
            await emit("widget-status", statusRef.current);
          } catch { /* not in Tauri */ }
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { unlistenToggle?.(); unlistenShowMain?.(); unlistenReady?.(); };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let registeredShortcut: string | null = null;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("tray-action", (event) => {
          if (event.payload === "start" && !connectedRef.current) {
            startRef.current(undefined, "Tray");
          } else if (event.payload === "stop" && connectedRef.current) {
            stopRef.current();
          }
        });
      } catch { /* not in Tauri */ }
      // Register global shortcut for push-to-talk
      try {
        const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
        // Unregister any previous shortcut first (handles StrictMode re-run)
        if (registeredShortcut) {
          try { await unregister(registeredShortcut); } catch { /* ok */ }
        }
        const savedHotkey = localStorage.getItem("stt-hotkey") || "CommandOrControl+Shift+Space";
        await register(savedHotkey, (event) => {
          if (event.state === "Pressed") {
            if (connectedRef.current) {
              console.log("[PTT] Ignored — already recording");
              return;
            }
            console.log("[PTT] Hotkey pressed — starting recording");
            startRef.current(settings, "Hotkey");
          } else if (event.state === "Released") {
            console.log("[PTT] Hotkey released — committing text");
            if (!connectedRef.current) {
              console.log("[PTT] Not recording — nothing to commit");
              return;
            }
            // Wait briefly for in-flight transcription to complete, then stop+commit
            setTimeout(() => {
              stopRef.current();
            }, 300);
          }
        });
        registeredShortcut = savedHotkey;
        console.log(`[PTT] Global shortcut registered: ${savedHotkey}`);
      } catch (e) {
        console.warn("[PTT] Failed to register global shortcut:", e);
      }
    })();
    return () => {
      unlisten?.();
      // Unregister global shortcut on cleanup
      if (registeredShortcut) {
        import("@tauri-apps/plugin-global-shortcut")
          .then(({ unregister }) => unregister(registeredShortcut!))
          .catch(() => {});
      }
    };
  }, [hotkey]);

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
      <>
        <ErrorBanner
          errors={errors}
          onDismiss={dismissError}
          onRetry={(id) => { dismissError(id); }}
          visible={showErrors}
          onClose={() => setShowErrors(false)}
        />
        <OnboardingWizard onFinished={handleOnboardingComplete} />
      </>
    );
  }

  const handleNavigate = (item: string) => {
    setActiveItem(item);
    if (item === "Settings" || item === "Config") {
      setShowSettings(true);
    }
  };

  const content = (() => {
    switch (activeItem) {
      case "Config":
      case "Settings":
        return null;
      case "Insights":
        return <InsightsPage />;
      case "Dictionary":
        return <DictionaryPage />;
      case "History":
        return <HistoryPage onBack={() => setActiveItem("Home")} />;
      case "Models":
        return <ModelsPage />;
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
            onRequestMicPermission={() => setShowMicModal(true)}
            asrProfile={settings.asrProfile}
            resolvedModel={resolvedModel}
          />
        );
    }
  })();

  return (
    <>
      <AppShell activeItem={activeItem} onNavigate={handleNavigate}>
        {content}
      </AppShell>

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-app-surface border border-border rounded-card text-[14px] text-text-primary shadow-lg animate-toast-in">
          {toast}
        </div>
      )}
      <SettingsPanel
        visible={showSettings}
        settings={settings}
        onSave={async (s) => {
          setSettings(s);
          setSettingsVersion((v) => v + 1); // Trigger engine respawn with new CLI args
          if (connectedRef.current) {
            stopRef.current();
          }
        }}
        onClose={() => {
          setShowSettings(false);
          setActiveItem("Home");
        }}
      />
      <MicPermissionModal
        visible={showMicModal}
        onOpenConfig={() => {
          setShowMicModal(false);
          setShowSettings(true);
        }}
        onClose={() => setShowMicModal(false)}
      />
      <PttOverlay visible={pttActive} />
    </>
  );
}

export default App;
