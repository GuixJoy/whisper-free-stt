import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface MicButtonProps {
  status: string;
  connected: boolean;
  onToggle: () => void;
}

export default function MicButton({ status, connected, onToggle }: MicButtonProps) {
  const isListening = status === "listening";
  const isError = status === "error";
  const isTranscribing = status === "transcribing";
  const isRewriting = status === "rewriting";
  const isIdle = status === "idle";
  const isPulsing = isListening || isTranscribing;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onToggle}
        aria-pressed={connected}
        className={cn(
          "relative flex items-center justify-center rounded-full transition duration-200",
          "w-[80px] h-[80px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg",
          isError && [
            "bg-app-surface-secondary border-2 border-[#EF4444]",
            "shadow-[0_0_40px_rgba(239,68,68,0.25)]",
          ],
          isPulsing && [
            "bg-accent border-2 border-accent",
            "shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.08)]",
            "animate-mic-pulse",
          ],
          isRewriting && [
            "bg-accent-surface border-2 border-accent/40",
            "shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
          ],
          isIdle && [
            "bg-app-surface-secondary border-2 border-border-hover",
            "hover:border-border-hover hover:bg-app-hover",
          ],
        )}
        aria-label={connected ? "Stop transcription" : "Start transcription"}
      >
        <div
          className={cn(
            "transition-colors duration-200",
            isPulsing ? "text-white" : isRewriting ? "text-accent" : isError ? "text-white" : "text-text-muted",
          )}
        >
          <Mic size={28} strokeWidth={1.5} aria-hidden="true" />
        </div>
      </button>
      {isIdle && (
        <span className="text-[11px] text-text-muted select-none">
          Press <kbd className="px-1 py-0.5 bg-border border border-border-hover rounded text-[11px] font-mono">Space</kbd> to start
        </span>
      )}
    </div>
  );
}
