import { useEffect, useRef, useState, useCallback } from "react";
import { Maximize2, Mic, X } from "lucide-react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

type WidgetStatus = "idle" | "listening" | "transcribing" | "rewriting" | "error";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function WaveformBars({ level }: { level: number }) {
  const bars = 12;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const levelRef = useRef(0);

  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 84;
    const h = 28;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const barWidth = 4;
    const gap = (w - bars * barWidth) / (bars - 1);
    const maxHeight = h - 6;

    const drawStatic = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#FF3B56";
      for (let i = 0; i < bars; i++) {
        const x = i * (barWidth + gap);
        const y = (h - 3) / 2;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, 3, 1.5);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    if (prefersReducedMotion()) {
      drawStatic();
      return;
    }

    let t = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      t += 0.045;

      const micLevel = Math.min(1, levelRef.current * 2.5);
      ctx.fillStyle = "#FF3B56";

      for (let i = 0; i < bars; i++) {
        const noise1 = Math.sin(t * 5.3 + i * 2.1) * 0.5 + 0.5;
        const noise2 = Math.sin(t * 3.7 + i * 4.3) * 0.5 + 0.5;
        const base = 0.15 + micLevel * 0.4;
        const amplitude = Math.min(1, base + (noise1 * 0.6 + noise2 * 0.4) * (0.2 + micLevel * 0.6));
        const barH = Math.max(3, amplitude * maxHeight);

        const x = i * (barWidth + gap);
        const y = (h - barH) / 2;

        ctx.globalAlpha = 0.45 + micLevel * 0.5;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 1.5);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return <canvas ref={canvasRef} className="shrink-0" aria-hidden="true" />;
}

const STATUS_LABEL: Record<WidgetStatus, string> = {
  idle: "Idle",
  listening: "Listening",
  transcribing: "Transcribing",
  rewriting: "Rewriting",
  error: "Error",
};

export default function WidgetView() {
  const [status, setStatus] = useState<WidgetStatus>("idle");
  const [connected, setConnected] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  useEffect(() => {
    if (!isTauri()) return;

    let unlistenStatus: (() => void) | undefined;
    let unlistenLevel: (() => void) | undefined;

    const init = async () => {
      unlistenStatus = await listen<WidgetStatus>("widget-status", (event) => {
        setStatus(event.payload);
        setConnected(["listening", "transcribing", "rewriting"].includes(event.payload));
      });

      unlistenLevel = await listen<number>("widget-mic-level", (event) => {
        setMicLevel(event.payload);
      });

      // Handshake: main window resends current status so a late-opened
      // widget never sticks on "Idle".
      await emit("widget-ready");
    };

    init();

    return () => {
      unlistenStatus?.();
      unlistenLevel?.();
    };
  }, []);

  const handleToggle = useCallback(async () => {
    if (!isTauri()) return;
    await emit("widget-toggle");
  }, []);

  const handleShowMain = useCallback(async () => {
    if (!isTauri()) return;
    await emit("widget-show-main");
  }, []);

  const handleHide = useCallback(async () => {
    if (!isTauri()) return;
    await invoke("hide_widget");
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        handleHide();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleHide]);

  const isActive = ["listening", "transcribing", "rewriting"].includes(status);
  const isError = status === "error";
  const expanded = isActive || isError;

  return (
    <div
      className="select-none w-full h-full flex items-center justify-center relative"
      style={{ background: "transparent" }}
      onContextMenu={(e) => {
        e.preventDefault();
        handleShowMain();
      }}
    >
      <div
        data-tauri-drag-region
        role="toolbar"
        aria-label="Dictation controls"
        className="relative h-[52px] rounded-[16px] flex items-center gap-1 overflow-hidden px-[4px]"
        style={{
          width: expanded ? 248 : 168,
          transition: "width 200ms ease-out",
          background: isActive
            ? "linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,240,242,0.75) 100%)"
            : isError
              ? "linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,235,235,0.75) 100%)"
              : "linear-gradient(135deg, rgba(255,255,255,0.80) 0%, rgba(255,255,255,0.60) 100%)",
          border: isActive
            ? "1px solid rgba(255,59,86,0.30)"
            : isError
              ? "1px solid rgba(239,68,68,0.30)"
              : "1px solid rgba(44,37,32,0.10)",
          boxShadow:
            "0 8px 24px rgba(44,37,32,0.12), inset 0 1px 0 rgba(255,255,255,0.8)",
        }}
      >
        {/* Mic toggle — primary action, always visible */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          aria-pressed={connected}
          aria-label={connected ? "Stop transcription" : "Start transcription"}
          className="relative z-10 w-[44px] h-[44px] shrink-0 rounded-[12px] flex items-center justify-center transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          style={{
            color: isActive ? "#FFFFFF" : isError ? "#DC2626" : "#6B6560",
            background: isActive ? "#FF3B56" : isError ? "rgba(239,68,68,0.10)" : "rgba(44,37,32,0.06)",
            border: isActive
              ? "1px solid #FF3B56"
              : "1px solid rgba(44,37,32,0.08)",
          }}
        >
          <Mic size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        {/* Expanded area: waveform + status */}
        <div
          className="flex items-center gap-2 flex-1 h-full overflow-hidden"
          style={{
            opacity: expanded ? 1 : 0,
            transform: expanded ? "translateX(0)" : "translateX(-8px)",
            transition: "opacity 200ms ease-out, transform 200ms ease-out",
            pointerEvents: expanded ? "auto" : "none",
            maxWidth: expanded ? 120 : 0,
          }}
          aria-hidden={!expanded}
        >
          {isActive && <WaveformBars level={micLevel} />}
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: isError ? "#EF4444" : "#FF3B56" }}
            />
            <span className={isError ? "text-red-600" : "text-text-secondary"}>
              {STATUS_LABEL[status]}
            </span>
          </span>
        </div>

        {/* Open main window */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleShowMain();
          }}
          aria-label="Open main window"
          className="relative z-10 w-[44px] h-[44px] shrink-0 rounded-[12px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>

        {/* Hide widget */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleHide();
          }}
          aria-label="Hide widget"
          className="relative z-10 w-[44px] h-[44px] shrink-0 rounded-[12px] flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
