import { useEffect, useRef, useState, useCallback } from "react";
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
import { useSettings } from "./hooks/useSettings";
import { useEngine } from "./hooks/useEngine";
import { useHistoryLog } from "./hooks/useHistoryLog";
import { FeedView, type TranscriptLine } from "./views/FeedView";
import { categoryForKind } from "./lib/errors";
import { getStoredHotkey } from "./lib/settings";

function App() {
  const { settings, setSettings, syncError } = useSettings();
  const [toast, setToast] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [showMicModal, setShowMicModal] = useState(false);
  const [view, setView] = useState<AppView>(
    localStorage.getItem("onboarding_completed") === "true" ? "main" : "onboarding",
  );
  const [errors, setErrors] = useState<AppError[]>([]);
  const [activeItem, setActiveItem] = useState("Home");
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [hotkey] = useState(() => getStoredHotkey());

  const feedRef = useRef<HTMLDivElement | null>(null);

  const addError = useCallback(
    (category: AppError["category"], message: string, canRetry = false, retryHint?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setErrors((prev) => [
        ...prev,
        { id, category, message, canRetry, retryHint, dismissed: false },
      ]);
      setShowErrors(true);
    },
    [],
  );

  const dismissError = useCallback((id: string) => {
    setErrors((prev) => prev.map((e) => (e.id === id ? { ...e, dismissed: true } : e)));
  }, []);

  const dismissErrorsOfCategory = useCallback((category: AppError["category"]) => {
    setErrors((prev) => prev.map((e) => (e.category === category ? { ...e, dismissed: true } : e)));
  }, []);

  const {
    connected,
    status,
    lines,
    resolvedModel,
    pttActive,
    start,
    stop,
    clearLines,
    connectedRef,
    statusRef,
    startRef,
    stopRef,
  } = useEngine({ settingsVersion, addError, dismissErrorsOfCategory, setToast });

  const history = useHistoryLog(feedRef, view === "main");

  useEffect(() => {
    const setVH = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };
    setVH();
    window.addEventListener("resize", setVH);
    return () => window.removeEventListener("resize", setVH);
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
        const prefix =
          status === "idle"
            ? "[·]"
            : status === "listening"
              ? "[rec]"
              : status === "transcribing"
                ? "[tx]"
                : "[on]";
        await win.setTitle(`${prefix} STT — ${status}`);
      } catch {
        /* not in Tauri */
      }
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
      if (
        e.code === "Space" &&
        tag !== "INPUT" &&
        tag !== "SELECT" &&
        tag !== "TEXTAREA" &&
        !isInteractive
      ) {
        e.preventDefault();
        if (connectedRef.current) stopRef.current();
        else startRef.current(undefined, "SpaceBar");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, connectedRef, startRef, stopRef]);

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

  // --- Widget: emit status to widget window ---
  useEffect(() => {
    (async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit("widget-status", status);
      } catch {
        /* not in Tauri */
      }
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
          } catch {
            /* not in Tauri */
          }
        });
        // Widget opened late misses earlier status broadcasts — resend on handshake.
        unlistenReady = await listen("widget-ready", async () => {
          try {
            await emit("widget-status", statusRef.current);
          } catch {
            /* not in Tauri */
          }
        });
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      unlistenToggle?.();
      unlistenShowMain?.();
      unlistenReady?.();
    };
  }, [connectedRef, statusRef, startRef, stopRef]);

  // --- Tray actions + global push-to-talk shortcut ---
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
      } catch {
        /* not in Tauri */
      }
      // Register global shortcut for push-to-talk
      try {
        const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
        // Unregister any previous shortcut first (handles StrictMode re-run)
        if (registeredShortcut) {
          try {
            await unregister(registeredShortcut);
          } catch {
            /* ok */
          }
        }
        const savedHotkey = getStoredHotkey();
        // A release schedules stop 300ms out; a re-press inside that window
        // cancels it and keeps the same session (no restart, no lost tail).
        let pendingStop: number | null = null;
        await register(savedHotkey, (event) => {
          if (event.state === "Pressed") {
            if (pendingStop !== null) {
              window.clearTimeout(pendingStop);
              pendingStop = null;
              console.log("[PTT] Re-press — scheduled stop cancelled");
              return;
            }
            if (connectedRef.current) {
              console.log("[PTT] Ignored — already recording");
              return;
            }
            console.log("[PTT] Hotkey pressed — starting recording");
            // start()'s overrideSettings parameter is unused (the backend reads
            // its config from disk), so there is nothing to thread through here.
            startRef.current(undefined, "Hotkey");
          } else if (event.state === "Released") {
            console.log("[PTT] Hotkey released — committing text");
            if (!connectedRef.current) {
              console.log("[PTT] Not recording — nothing to commit");
              return;
            }
            // Wait briefly for in-flight transcription to complete, then stop+commit
            if (pendingStop !== null) window.clearTimeout(pendingStop);
            pendingStop = window.setTimeout(() => {
              pendingStop = null;
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
  }, [hotkey, connectedRef, startRef, stopRef]);

  // --- Bare Ctrl+Win hold-to-talk (Windows native hook, backend emits) ---
  // Reuses the same start/stop refs, so overlay, sounds, widget, and guards
  // apply. Coexists with the registered shortcut; both funnel here.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<string>("ptt-hook", (event) => {
          if (event.payload === "pressed") {
            if (!connectedRef.current) startRef.current(undefined, "Hook");
          } else if (connectedRef.current) {
            stopRef.current();
          }
        });
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [connectedRef, startRef, stopRef]);

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
          onRetry={(id) => {
            dismissError(id);
          }}
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
            historyItems={history.items}
            historyLoading={history.loading}
            hasMoreHistory={history.hasMore}
            onFeedScroll={history.onScroll}
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
        <div
          role="status"
          aria-live="polite"
          className="animate-toast-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-card border border-border bg-app-surface px-4 py-2.5 text-[14px] text-text-primary shadow-lg"
        >
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
