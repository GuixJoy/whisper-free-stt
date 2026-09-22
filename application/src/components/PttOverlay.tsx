import { useEffect, useState } from "react";
import { Mic } from "lucide-react";

interface PttOverlayProps {
  visible: boolean;
}

export default function PttOverlay({ visible }: PttOverlayProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      setShow(true);
    } else {
      // Small delay before hiding for smooth exit
      const timer = setTimeout(() => setShow(false), 200);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!show) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-8 left-1/2 z-[9999] -translate-x-1/2"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? "0" : "8px"})`,
        transition: "opacity 200ms ease-out, transform 200ms ease-out",
      }}
    >
      <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-[#2C2520]/90 px-4 py-2.5 shadow-lg backdrop-blur-sm">
        {/* Pulsing mic icon */}
        <div className="relative flex h-[28px] w-[28px] items-center justify-center">
          <div
            className="ptt-pulse absolute inset-0 rounded-full bg-accent"
            style={{
              animation: visible ? "ptt-pulse 1.5s ease-in-out infinite" : "none",
            }}
          />
          <Mic size={14} className="relative z-10 text-white" />
        </div>

        <span className="text-[13px] font-medium text-white/90">Listening…</span>

        {/* Waveform dots */}
        <div className="ml-1 flex items-center gap-[3px]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="ptt-wave w-[3px] rounded-full bg-accent"
              style={{
                height: "12px",
                animation: visible
                  ? `ptt-wave 0.8s ease-in-out ${i * 0.15}s infinite alternate`
                  : "none",
              }}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes ptt-pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.15); }
        }
        @keyframes ptt-wave {
          0% { height: 4px; }
          100% { height: 14px; }
        }
      `}</style>
    </div>
  );
}
