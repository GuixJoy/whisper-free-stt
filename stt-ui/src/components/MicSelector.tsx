import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { micLevelEmitter } from "../utils/mic-emitter";

export interface MicDevice {
  index: number;
  name: string;
  channels: number;
  sampleRate: number;
}

interface Props {
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onTest: () => void;
  compact?: boolean;
}

export default function MicSelector({ onTest, compact }: Props) {
  const [testing, setTesting] = useState(false);
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return micLevelEmitter.subscribe((level) => {
      if (fillRef.current) {
        fillRef.current.style.width = `${Math.min(100, level * 300)}%`;
      }
    });
  }, []);

  const handleTest = () => {
    setTesting(true);
    onTest();
    setTimeout(() => setTesting(false), 3000);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-input bg-app-surface-secondary overflow-hidden border border-border">
          <div ref={fillRef} className="h-full bg-accent rounded-input transition-[width] duration-75" style={{ width: "0%" }} />
        </div>
        <button
          className={cn(
            "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
            "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          onClick={handleTest}
        >
          {testing ? "⏳" : "🎤"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-text-secondary text-label font-semibold">
        <span>🎤</span> Microphone
      </div>

      <div className="h-3 rounded-input bg-app-surface-secondary overflow-hidden border border-border">
        <div ref={fillRef} className="h-full bg-accent rounded-input transition-[width] duration-75" style={{ width: "0%" }} />
      </div>

      <button
        className={cn(
          "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
          testing
            ? "bg-red-900/40 border border-red-500/30 text-red-400"
            : "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
        onClick={handleTest}
      >
        {testing ? "Testing..." : "Test Microphone"}
      </button>
    </div>
  );
}
