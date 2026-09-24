import { useEffect, useRef, useState } from "react";
import type { STTApi, STTEvent } from "../api";
import { createTauriApi } from "../api-tauri";
import { micLevelEmitter } from "../utils/mic-emitter";
import { playPttStart, playPttStop } from "../lib/ptt-sound";
import { type RuntimeSettings } from "../lib/settings";
import type { AppError } from "../components/ErrorBanner";
import type { TranscriptLine } from "../views/FeedView";

type ErrorCategory = AppError["category"];

interface Options {
  /** Bumped by App when settings are saved; respawns the engine. */
  settingsVersion: number;
  addError: (
    category: ErrorCategory,
    message: string,
    canRetry?: boolean,
    retryHint?: string,
  ) => void;
  dismissErrorsOfCategory: (category: ErrorCategory) => void;
  setToast: (message: string) => void;
}

/**
 * Owns the engine process, its event stream, and the recording state.
 *
 * The refs are returned deliberately. The widget, tray, hotkey and keyboard
 * listeners in App register with empty dependency arrays, so they must read
 * *current* state and call the *current* start/stop rather than whatever was
 * captured when they were attached. They are the reason this is not just a
 * bag of state.
 */
export function useEngine({
  settingsVersion,
  addError,
  dismissErrorsOfCategory,
  setToast,
}: Options) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("idle");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [resolvedModel, setResolvedModel] = useState<{
    profile: string;
    model: string;
    backend: string;
    device: string;
  } | null>(null);
  const [pttActive, setPttActive] = useState(false);

  const runtimeRef = useRef<STTApi | null>(null);
  // Bumped on every (re)spawn. Async callbacks from a previous generation must
  // not touch the current engine: a stale spawn().catch() used to set
  // runtimeRef to null and clobber the live handle.
  const engineGenerationRef = useRef(0);
  const nextLocalId = useRef(1);
  const connectedRef = useRef(connected);
  const statusRef = useRef(status);
  const lastWidgetMicEmit = useRef(0);
  // Widget auto-show: set when PTT shows a hidden widget, so stop() only
  // hides what PTT opened — a manually opened widget is left alone.
  const widgetVisibleRef = useRef(false);
  const widgetAutoRef = useRef(false);
  const isStartingRef = useRef(false);
  const startRef = useRef<(overrideSettings?: RuntimeSettings, source?: string) => void>(() => {});
  const stopRef = useRef<() => void>(() => {});

  connectedRef.current = connected;
  statusRef.current = status;

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
          } catch {
            /* not in Tauri */
          }
        })();
      }
      return;
    }
    if (event.type === "asr_ready") {
      setResolvedModel({
        profile: "parakeet",
        model: "Parakeet TDT",
        backend: event.backend,
        device: "cuda",
      });
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
        return [
          ...prev,
          {
            id,
            raw: event.text,
            processed: "",
            status: "transcribing",
            createdAt: new Date().toISOString(),
          },
        ].slice(-500);
      });
      return;
    }
    if (event.type === "asr_final") {
      setLines((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.status === "transcribing") {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              raw: event.text,
              processed: event.text,
              status: "transcribing",
              createdAt: last.createdAt,
            },
          ];
        }
        return [
          ...prev,
          {
            id: nextLocalId.current++,
            raw: event.text,
            processed: event.text,
            status: "transcribing",
            createdAt: new Date().toISOString(),
          },
        ].slice(-500);
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
          return [
            ...prev.slice(0, -1),
            { ...last, processed: updatedProcessed, status: "rewriting" },
          ];
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

  // --- Engine lifecycle: spawn once on mount, keep alive permanently ---
  useEffect(() => {
    // StrictMode guard: prevent double-spawn in development
    if (runtimeRef.current) return;

    const generation = ++engineGenerationRef.current;
    const api: STTApi = createTauriApi();

    api.onEvent(applyEvent);
    runtimeRef.current = api;

    // Track widget visibility so PTT stop() only hides a widget PTT opened.
    let unlistenWidget: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlistenWidget = await listen<boolean>("widget-visibility-changed", (event) => {
          widgetVisibleRef.current = event.payload;
        });
      } catch {
        /* not in Tauri */
      }
    })();

    // Spawn backend — loads models, warms ASR, stays idle until PTT
    api
      .spawn()
      .then(async () => {
        if (engineGenerationRef.current !== generation) return;
        console.log("[Engine] Backend ready — waiting for PTT hotkey");
        // Start-up notice: if the backend is still warming engines, say so
        // now; the asr_ready toast announces completion.
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const st = await invoke<string>("engine_status");
          if (engineGenerationRef.current !== generation) return;
          if (st === "warming") {
            setToast("Warming up engines — first launch takes a moment…");
          }
        } catch {
          /* not in Tauri */
        }
      })
      .catch((err) => {
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
      unlistenWidget?.();
      // Only clear if we still own the ref — a newer generation may have
      // already replaced it.
      if (runtimeRef.current === api) runtimeRef.current = null;
    };
  }, [settingsVersion]);

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
    playPttStart();
    // Pop the widget globally so recording is visible outside the app.
    // Only mark auto-show when it was hidden — a manually opened widget
    // stays under the user's control.
    if (!widgetVisibleRef.current) {
      widgetAutoRef.current = true;
      // Fire-and-forget: awaiting here opens a window where a quick release
      // sees connected=false, skips the stop, and leaves the mic running
      // until the next press.
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("show_widget"))
        .catch(() => {
          /* widget is best-effort — never break PTT over it */
        });
    }
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
    playPttStop();
    if (widgetAutoRef.current) {
      widgetAutoRef.current = false;
      if (widgetVisibleRef.current) {
        // Fire-and-forget, as in start(): the backend stop must not queue
        // behind a window call.
        void import("@tauri-apps/api/core")
          .then(({ invoke }) => invoke("hide_widget"))
          .catch(() => {
            /* widget is best-effort — never break PTT over it */
          });
      }
    }
    runtimeRef.current.stop(); // Sends stop_recording to backend
    setConnected(false);
    setStatus("idle");
    setPttActive(false);
    micLevelEmitter.emit(0);
  };

  startRef.current = start;
  stopRef.current = stop;

  const clearLines = () => setLines([]);

  return {
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
  };
}
