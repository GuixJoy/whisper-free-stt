// ── Microphone selector with live VU meter ──
import { useEffect, useRef, useState } from "react";
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
      <div className="mic-selector-compact">
        <div className="mic-meter-compact">
          <div ref={fillRef} className="mic-meter-compact-fill" style={{ width: "0%" }} />
        </div>
        <button className="sketch-btn btn-sm" onClick={handleTest}>
          {testing ? "⏳" : "🎤"}
        </button>
      </div>
    );
  }

  return (
    <div className="mic-selector">
      <div className="ctrl-section-header">
        <span>🎤</span> Microphone
      </div>

      <div className="mic-meter-large">
        <div ref={fillRef} className="mic-meter-large-fill" style={{ width: "0%" }} />
      </div>

      <button
        className={`sketch-btn btn-sm ${testing ? "btn-stop" : ""}`}
        onClick={handleTest}
      >
        {testing ? "Testing..." : "Test Microphone"}
      </button>
    </div>
  );
}
