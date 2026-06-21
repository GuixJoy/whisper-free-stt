import { useEffect, useRef, useState, useCallback } from "react";
import { Maximize2, X } from "lucide-react";
import { MicIcon } from "./icons/MicIcon";
import { MicOffIcon } from "./icons/MicOffIcon";
import { LanguagesIcon } from "./icons/LanguagesIcon";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

type WidgetStatus = "idle" | "listening" | "transcribing" | "rewriting" | "error";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Detect backdrop-filter support (WebKitGTK on Linux often lacks it)
function supportsBackdropFilter(): boolean {
  if (typeof CSS === "undefined") return false;
  return CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)");
}

const HAS_BLUR = supportsBackdropFilter();

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
    const w = 120;
    const h = 28;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const barWidth = 3;
    const gap = (w - bars * barWidth) / (bars - 1);
    const maxHeight = h - 6;

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "rgba(27, 79, 130, 0.9)");
    gradient.addColorStop(0.5, "rgba(80, 120, 200, 1)");
    gradient.addColorStop(1, "rgba(20, 60, 105, 0.8)");

    let t = 0;

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      t += 0.045;

      const micLevel = Math.min(1, levelRef.current * 2.5);
      ctx.fillStyle = gradient;
      ctx.shadowColor = "rgba(27, 79, 130, 0.3)";
      ctx.shadowBlur = 4;

      for (let i = 0; i < bars; i++) {
        const noise1 = Math.sin(t * 5.3 + i * 2.1) * 0.5 + 0.5;
        const noise2 = Math.sin(t * 3.7 + i * 4.3) * 0.5 + 0.5;
        const base = 0.15 + micLevel * 0.4;
        const amplitude = Math.min(1, base + (noise1 * 0.6 + noise2 * 0.4) * (0.2 + micLevel * 0.6));
        const barH = Math.max(3, amplitude * maxHeight);

        const x = i * (barWidth + gap);
        const y = (h - barH) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 1.5);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return <canvas ref={canvasRef} className="shrink-0" />;
}

function StatusLabel({ status }: { status: WidgetStatus }) {
  const label = (() => {
    switch (status) {
      case "listening": return "Listening";
      case "transcribing": return "Transcribing";
      case "rewriting": return "Rewriting";
      case "error": return "Error";
      default: return "";
    }
  })();

  if (!label) return null;

  return (
    <span className={`text-[11px] font-medium tracking-wide whitespace-nowrap transition-colors duration-300 ${
      status === "error" ? "text-red-400/90" : "text-amber-200/80"
    }`}>
      {label}
    </span>
  );
}

export default function WidgetView() {
  const [status, setStatus] = useState<WidgetStatus>("idle");
  const [connected, setConnected] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    setShowMenu(false);
  }, []);

  const handleQuit = useCallback(async () => {
    if (!isTauri()) return;
    await invoke("hide_widget");
    setShowMenu(false);
  }, []);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMenu]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        handleToggle();
      }
      if (e.code === "Escape") {
        handleQuit();
        setShowMenu(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleToggle, handleQuit]);

  const isActive = ["listening", "transcribing", "rewriting"].includes(status);
  const isError = status === "error";
  const expanded = isActive || isError;

  return (
    <div
      className="select-none w-full h-full flex items-center justify-center relative"
      style={{ background: "transparent" }}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowMenu((v) => !v);
      }}
    >
      <div
        data-tauri-drag-region
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative h-[44px] rounded-[14px] cursor-grab active:cursor-grabbing flex items-center overflow-hidden"
        style={{
          width: expanded ? 220 : hovered ? 64 : 48,
          transition: "width 450ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Premium Liquid Glass Body */}
        <div
          className="absolute inset-0 rounded-[14px]"
          style={{
            background: isActive
              ? HAS_BLUR
                ? "linear-gradient(135deg, rgba(255,59,86,0.10) 0%, rgba(255,59,86,0.03) 50%, rgba(255,59,86,0.08) 100%)"
                : "rgba(30,20,10,0.92)"
              : isError
                ? HAS_BLUR
                  ? "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(220,38,38,0.04) 50%, rgba(239,68,68,0.08) 100%)"
                  : "rgba(30,10,10,0.92)"
                : HAS_BLUR
                  ? "linear-gradient(135deg, rgba(44,37,32,0.12) 0%, rgba(44,37,32,0.04) 50%, rgba(44,37,32,0.08) 100%)"
                  : "rgba(20,20,20,0.92)",
            backdropFilter: HAS_BLUR ? "blur(24px) saturate(180%)" : "none",
            WebkitBackdropFilter: HAS_BLUR ? "blur(24px) saturate(180%)" : "none",
            border: isActive
              ? "1px solid rgba(255,59,86,0.22)"
              : isError
                ? "1px solid rgba(239,68,68,0.2)"
                : "1px solid rgba(44,37,32,0.15)",
            boxShadow: isActive
              ? "0 8px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(44,37,32,0.15)"
              : isError
                ? "0 8px 32px rgba(239,68,68,0.15), inset 0 1px 0 rgba(44,37,32,0.15)"
                : "0 8px 32px rgba(44,37,32,0.4), inset 0 1px 0 rgba(44,37,32,0.12)",
          }}
        />

        {/* Top highlight arc for glass refraction */}
        <div
          className="absolute inset-0 rounded-[14px] pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(44,37,32,0.12) 0%, transparent 40%)" }}
        />

        {/* Bottom depth shadow */}
        <div
          className="absolute inset-0 rounded-[14px] pointer-events-none"
          style={{ background: "linear-gradient(0deg, rgba(44,37,32,0.15) 0%, transparent 30%)" }}
        />

        {/* Idle breathing glow */}
        {!expanded && (
          <div
            className="absolute inset-0 rounded-[14px] pointer-events-none"
            style={{
              background: "radial-gradient(circle at center, rgba(255,59,86,0.06) 0%, transparent 70%)",
              animation: "widget-breathe 4s ease-in-out infinite",
            }}
          />
        )}

        {/* Mic button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          className="relative z-10 w-[40px] h-[40px] shrink-0 rounded-[10px] ml-[4px] flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:ring-offset-2 focus:ring-offset-transparent"
          style={{
            color: isActive
              ? "rgba(255,59,86,0.95)"
              : isError
                ? "rgba(239,68,68,0.95)"
                : "rgba(44,37,32,0.45)",
            background: isActive
              ? "rgba(255,59,86,0.12)"
              : isError
                ? "rgba(239,68,68,0.12)"
                : "rgba(44,37,32,0.08)",
            border: isActive
              ? "1px solid rgba(255,59,86,0.20)"
              : isError
                ? "1px solid rgba(239,68,68,0.15)"
                : "1px solid rgba(44,37,32,0.12)",
            backdropFilter: HAS_BLUR ? "blur(8px)" : "none",
            WebkitBackdropFilter: HAS_BLUR ? "blur(8px)" : "none",
          }}
          aria-label={connected ? "Stop transcription" : "Start transcription"}
        >
          {connected ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
        </button>

        {/* Languages button (coming soon) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowComingSoon(true);
            setTimeout(() => setShowComingSoon(false), 2000);
          }}
          className="relative z-10 w-[32px] h-[32px] shrink-0 rounded-[8px] flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 focus:outline-none"
          style={{
            color: "rgba(44,37,32,0.30)",
            background: "rgba(44,37,32,0.06)",
            border: "1px solid rgba(44,37,32,0.08)",
          }}
          aria-label="Language selection (coming soon)"
        >
          <LanguagesIcon size={15} />
        </button>

        {/* Expanded area: waveform + status */}
        <div
          className="flex items-center gap-2 flex-1 pr-4 pl-2 h-full overflow-hidden"
          style={{
            opacity: expanded ? 1 : 0,
            transform: expanded ? "translateX(0)" : "translateX(-8px)",
            transition: "opacity 300ms ease 150ms, transform 300ms ease 150ms",
            pointerEvents: expanded ? "auto" : "none",
          }}
        >
          {isActive && <WaveformBars level={micLevel} />}
          <StatusLabel status={status} />
        </div>

        {/* Status indicator dot */}
        <div
          className="absolute z-20"
          style={{
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: isActive
              ? "#fbbf24"
              : isError
                ? "#ef4444"
                : "rgba(44,37,32,0.25)",
            boxShadow: isActive
              ? "0 0 8px rgba(0,0,0,0.15)"
              : isError
                ? "0 0 8px rgba(239,68,68,0.8)"
                : "none",
            animation: isActive ? "widget-dot-pulse 1.5s ease-in-out infinite" : "none",
          }}
        />
      </div>

      {/* Coming soon tooltip */}
      {showComingSoon && (
        <div
          className="absolute z-50 px-2.5 py-1 rounded-lg text-[11px] font-medium text-amber-200/90 whitespace-nowrap pointer-events-none"
          style={{
            top: -32,
            left: "50%",
            transform: "translateX(-50%)",
            background: "linear-gradient(135deg, rgba(42,38,34,0.96) 0%, rgba(36,33,32,0.98) 100%)",
            border: "1px solid rgba(255,59,86,0.18)",
            boxShadow: "0 8px 24px rgba(44,37,32,0.5)",
            animation: "widget-fade-in 200ms ease-out",
          }}
        >
          Coming soon
        </div>
      )}

      {/* Context Menu */}
      <div
        ref={menuRef}
        className={`absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 min-w-[160px] rounded-xl overflow-hidden transition-all duration-200 ease-out ${
          showMenu
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
        }`}
        style={{
          background: "linear-gradient(135deg, rgba(42,38,34,0.96) 0%, rgba(36,33,32,0.98) 100%)",
          backdropFilter: HAS_BLUR ? "blur(32px) saturate(200%)" : "none",
          WebkitBackdropFilter: HAS_BLUR ? "blur(32px) saturate(200%)" : "none",
          border: "1px solid rgba(44,37,32,0.12)",
          boxShadow: "0 20px 60px rgba(44,37,32,0.7), 0 0 0 1px rgba(44,37,32,0.06), inset 0 1px 0 rgba(44,37,32,0.08)",
        }}
      >
        <button
          onClick={handleShowMain}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-text-secondary hover:text-text-primary hover:bg-border-hover transition-colors focus:outline-none focus:bg-border-hover"
        >
          <Maximize2 size={14} />
          Open Main Window
        </button>
        <div className="h-px bg-border-hover mx-2" />
        <button
          onClick={handleQuit}
          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-text-secondary hover:text-red-400 hover:bg-red-500/[0.08] transition-colors focus:outline-none focus:bg-red-500/[0.08]"
        >
          <X size={14} />
          Hide Widget
        </button>
      </div>

      <style>{`
        @keyframes widget-breathe {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.03); }
        }
        @keyframes widget-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.75); }
        }
        @keyframes widget-fade-in {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
