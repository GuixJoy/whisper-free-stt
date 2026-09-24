import { useEffect, useRef, useState, useCallback } from "react";
import { isTauri } from "@/lib/utils";
import { Mic } from "lucide-react";
import { listen, emit } from "@tauri-apps/api/event";

type WidgetStatus = "idle" | "listening" | "transcribing" | "rewriting" | "error";

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
        const amplitude = Math.min(
          1,
          base + (noise1 * 0.6 + noise2 * 0.4) * (0.2 + micLevel * 0.6),
        );
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
  listening: "Listening…",
  transcribing: "Transcribing…",
  rewriting: "Rewriting…",
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

  const isActive = ["listening", "transcribing", "rewriting"].includes(status);
  const isError = status === "error";
  const expanded = isActive || isError;

  return (
    <div
      className="relative flex h-full w-full select-none items-center justify-center"
      style={{ background: "transparent" }}
    >
      <div
        data-tauri-drag-region
        role="toolbar"
        aria-label="Dictation controls"
        className="relative flex h-[52px] items-center gap-1 overflow-hidden rounded-[26px] px-[4px]"
        style={{
          width: expanded ? 248 : 168,
          transition: "width 200ms ease-out",
          background: "rgba(32,32,32,0.92)",
          border: isError ? "1px solid rgba(239,68,68,0.45)" : "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.08)",
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
          className="relative z-10 flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          style={{
            color: "#FFFFFF",
            background: isActive ? "#FF3B56" : "rgba(255,255,255,0.14)",
            border: isActive ? "1px solid #FF3B56" : "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <Mic size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        {/* Expanded area: waveform + status */}
        <div
          className="flex h-full flex-1 items-center gap-2 overflow-hidden"
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
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: isError ? "#EF4444" : "#FF3B56" }}
            />
            <span className={isError ? "text-red-400" : "text-white/80"}>
              {STATUS_LABEL[status]}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
