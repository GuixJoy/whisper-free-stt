// ── Microphone selector with live VU meter ──
import { useState } from "react";

export interface MicDevice {
  index: number;
  name: string;
  channels: number;
  sampleRate: number;
}

interface Props {
  selectedIndex: number | null;
  micLevel: number;
  onSelect: (index: number) => void;
  onTest: () => void;
  compact?: boolean;
}

export default function MicSelector({ micLevel, onTest, compact }: Props) {
  const [testing, setTesting] = useState(false);

  const handleTest = () => {
    setTesting(true);
    onTest();
    setTimeout(() => setTesting(false), 3000);
  };

  if (compact) {
    return (
      <div className="mic-selector-compact">
        <div className="mic-meter-compact">
          <div className="mic-meter-compact-fill" style={{ width: `${Math.min(100, micLevel * 300)}%` }} />
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
        <div className="mic-meter-large-fill" style={{ width: `${Math.min(100, micLevel * 300)}%` }} />
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
