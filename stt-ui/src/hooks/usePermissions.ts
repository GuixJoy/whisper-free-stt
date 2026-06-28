// ── Permissions hook: manages clipboard and microphone permissions ──
import { useState, useCallback, useRef, useEffect } from "react";
import { micLevelEmitter } from "../utils/mic-emitter";

export interface PermissionState {
  clipboard: "granted" | "denied" | "prompt" | "unavailable";
  microphone: "granted" | "denied" | "prompt" | "unavailable";
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

export function usePermissions() {
  const [permissions, setPermissions] = useState<PermissionState>({
    clipboard: "prompt",
    microphone: "prompt",
  });
  const [isCapturingMic, setIsCapturingMic] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const checkClipboardPermission = useCallback(async () => {
    try {
      if (isTauri()) {
        const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
        try {
          await readText();
          setPermissions((p) => ({ ...p, clipboard: "granted" }));
        } catch {
          setPermissions((p) => ({ ...p, clipboard: "prompt" }));
        }
      } else if (navigator.clipboard && navigator.permissions) {
        const status = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        setPermissions((p) => ({ ...p, clipboard: status.state as PermissionState["clipboard"] }));
      } else {
        setPermissions((p) => ({ ...p, clipboard: "unavailable" }));
      }
    } catch {
      setPermissions((p) => ({ ...p, clipboard: "unavailable" }));
    }
  }, []);

  const requestClipboard = useCallback(async () => {
    try {
      if (isTauri()) {
        const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
        await writeText("");
        setPermissions((p) => ({ ...p, clipboard: "granted" }));
        return true;
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText("");
        setPermissions((p) => ({ ...p, clipboard: "granted" }));
        return true;
      }
    } catch (err) {
      console.error("Clipboard permission denied", err);
      setPermissions((p) => ({ ...p, clipboard: "denied" }));
    }
    return false;
  }, []);

  const checkMicPermission = useCallback(async () => {
    try {
      if (isTauri()) {
        // Tauri handles mic natively — WebKitGTK Permissions API doesn't work
        setPermissions((p) => ({ ...p, microphone: "granted" }));
      } else if (navigator.permissions && navigator.permissions.query) {
        const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
        setPermissions((p) => ({ ...p, microphone: status.state as PermissionState["microphone"] }));
      } else {
        setPermissions((p) => ({ ...p, microphone: "prompt" }));
      }
    } catch {
      setPermissions((p) => ({ ...p, microphone: "prompt" }));
    }
  }, []);

  const requestMic = useCallback(async () => {
    if (isCapturingMic) {
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      setPermissions((p) => ({ ...p, microphone: "granted" }));
      setIsCapturingMic(true);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const emitLevel = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalizedLevel = average / 255;
        micLevelEmitter.emit(normalizedLevel);
        animFrameRef.current = requestAnimationFrame(emitLevel);
      };
      animFrameRef.current = requestAnimationFrame(emitLevel);

      return true;
    } catch (err) {
      console.error("Microphone permission denied", err);
      setPermissions((p) => ({ ...p, microphone: "denied" }));
      return false;
    }
  }, [isCapturingMic]);

  const stopMic = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    setIsCapturingMic(false);
    micLevelEmitter.emit(0);
  }, []);

  const checkPermissions = useCallback(() => {
    checkClipboardPermission();
    checkMicPermission();
  }, [checkClipboardPermission, checkMicPermission]);

  useEffect(() => {
    checkPermissions();
    return () => {
      stopMic();
    };
  }, [checkPermissions, stopMic]);

  return {
    permissions,
    isCapturingMic,
    requestClipboard,
    requestMic,
    stopMic,
  };
}
