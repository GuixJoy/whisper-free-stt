import { useEffect, useRef, useState, useCallback } from "react";
import { Maximize2, X } from "lucide-react";

type WidgetStatus = "idle" | "listening" | "transcribing" | "rewriting" | "error";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="transition-colors duration-300">
      <path
        d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z"
        fill={active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)"}
      />
      <path
        d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.93V22H13V18.93C16.39 18.43 19 15.53 19 12H17Z"
        fill={active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)"}
      />
    </svg>
  );
}

function WaveformBars() {
  const bars = 10;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 100;
    const h = 28;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const barWidth = 3;
    const gap = (w - bars * barWidth) / (bars - 1);
    const maxHeight = h - 4;
    const time = { v: 0 };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      time.v += 0.04;

      for (let i = 0; i < bars; i++) {
        const phase = i * 0.7;
        const wave1 = Math.sin(time.v * 3 + phase) * 0.4;
        const wave2 = Math.sin(time.v * 2.3 + phase * 1.5) * 0.25;
        const wave3 = Math.sin(time.v * 4.1 + phase * 0.8) * 0.15;
        const amplitude = 0.25 + (wave1 + wave2 + wave3 + 0.4) * 0.55;
        const barH = Math.max(3, amplitude * maxHeight);

        const x = i * (barWidth + gap);
        const y = (h - barH) / 2;

        const gradient = ctx.createLinearGradient(0, y, 0, y + barH);
        gradient.addColorStop(0, "rgba(199,119,44,0.9)");
        gradient.addColorStop(0.5, "rgba(232,168,72,0.95)");
        gradient.addColorStop(1, "rgba(199,119,44,0.8)");

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, 1.5);
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return <canvas ref={canvasRef} className="shrink-0" />;
}

export default function WidgetView() {
  const [status, setStatus] = useState<WidgetStatus>("idle");
  const [connected, setConnected] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<WidgetStatus>("widget-status", (event) => {
        setStatus(event.payload);
        setConnected(
          event.payload === "listening" ||
          event.payload === "transcribing" ||
          event.payload === "rewriting"
        );
      });
    })();
    return () => { unlisten?.(); };
  }, []);

  const handleToggle = useCallback(async () => {
    if (!isTauri()) return;
    const { emit } = await import("@tauri-apps/api/event");
    await emit("widget-toggle");
  }, []);

  const handleShowMain = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("show_widget");
    const { emit } = await import("@tauri-apps/api/event");
    await emit("widget-show-main");
    setShowMenu(false);
  }, []);

  const handleQuit = useCallback(async () => {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
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
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleToggle, handleQuit]);

  const isActive = status === "listening" || status === "transcribing" || status === "rewriting";
  const isError = status === "error";

  return (
    <div
      className="select-none w-full h-full flex items-center justify-center"
      style={{ background: "transparent" }}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowMenu((v) => !v);
      }}
    >
      <div
        data-tauri-drag-region
        className={`
          relative h-[44px] rounded-[14px] cursor-grab active:cursor-grabbing
          flex items-center gap-0 overflow-hidden
          transition-all duration-500 ease-out
          ${isActive
            ? "w-[190px] shadow-[0_0_32px_rgba(199,119,44,0.25),0_4px_24px_rgba(0,0,0,0.4)]"
            : isError
              ? "w-[190px] shadow-[0_0_32px_rgba(239,68,68,0.2),0_4px_24px_rgba(0,0,0,0.4)]"
              : "w-[52px] shadow-[0_4px_24px_rgba(0,0,0,0.5)]"
          }
        `}
        style={{
          background: isActive
            ? "linear-gradient(135deg, rgba(199,119,44,0.12) 0%, rgba(200,138,50,0.06) 50%, rgba(199,119,44,0.10) 100%)"
            : isError
              ? "linear-gradient(135deg, rgba(239,68,68,0.10) 0%, rgba(220,38,38,0.05) 50%, rgba(239,68,68,0.08) 100%)"
              : "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0.04) 100%)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          border: isActive
            ? "1px solid rgba(199,119,44,0.22)"
            : isError
              ? "1px solid rgba(239,68,68,0.18)"
              : "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {/* Top highlight */}
        <div
          className="absolute inset-0 rounded-[14px] pointer-events-none"
          style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 45%)" }}
        />
        {/* Bottom shadow */}
        <div
          className="absolute inset-0 rounded-[14px] pointer-events-none"
          style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.12) 0%, transparent 35%)" }}
        />

        {/* Mic button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          className={`
            relative z-10 w-[44px] h-[44px] shrink-0 rounded-[11px] ml-[3px]
            flex items-center justify-center
            transition-all duration-300 ease-out
            ${isActive
              ? "bg-[#C7772C]/25 hover:bg-[#C7772C]/35"
              : isError
                ? "bg-red-500/15 hover:bg-red-500/25"
                : "bg-white/[0.04] hover:bg-white/[0.08]"
            }
          `}
          style={{
            border: isActive
              ? "1px solid rgba(199,119,44,0.25)"
              : isError
                ? "1px solid rgba(239,68,68,0.2)"
                : "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
          aria-label={connected ? "Stop transcription" : "Start transcription"}
        >
          <MicIcon active={isActive || isError} />
        </button>

        {/* Waveform area */}
        {(isActive || isError) && (
          <div className="flex items-center flex-1 pr-3 pl-1 h-full">
            {isActive ? (
              <WaveformBars />
            ) : (
              <div className="flex items-center gap-1.5 pl-2">
                <span className="text-[11px] font-medium text-red-400/80">Error</span>
              </div>
            )}
          </div>
        )}

        {/* Status dot */}
        <div className={`absolute top-1.5 right-1.5 z-20 w-[5px] h-[5px] rounded-full transition-all duration-300 ${
          isActive
            ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]"
            : isError
              ? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]"
              : "bg-white/20"
        }`} />
      </div>

      {/* Context menu */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-50 min-w-[140px] rounded-xl overflow-hidden"
          style={{
            background: "linear-gradient(135deg, rgba(20,20,20,0.95) 0%, rgba(15,15,15,0.98) 100%)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)",
          }}
        >
          <button
            onClick={handleShowMain}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-[#a8a096] hover:text-[#f0ebe3] hover:bg-white/[0.06] transition-colors"
          >
            <Maximize2 size={14} />
            Open Main Window
          </button>
          <div className="h-px bg-white/[0.06] mx-2" />
          <button
            onClick={handleQuit}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-[#a8a096] hover:text-red-400 hover:bg-red-500/[0.08] transition-colors"
          >
            <X size={14} />
            Hide Widget
          </button>
        </div>
      )}
    </div>
  );
}
