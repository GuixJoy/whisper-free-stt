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
          "h-[80px] w-[80px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg",
          isError && [
            "border-2 border-[#EF4444] bg-app-surface-secondary",
            "shadow-[0_0_40px_rgba(239,68,68,0.25)]",
          ],
          isPulsing && [
            "border-2 border-accent bg-accent",
            "shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.08)]",
            "animate-mic-pulse",
          ],
          isRewriting && [
            "border-2 border-accent/40 bg-accent-surface",
            "shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
          ],
          isIdle && [
            "border-2 border-border-hover bg-app-surface-secondary",
            "hover:border-border-hover hover:bg-app-hover",
          ],
        )}
        aria-label={connected ? "Stop transcription" : "Start transcription"}
      >
        <div
          className={cn(
            "transition-colors duration-200",
            isPulsing
              ? "text-white"
              : isRewriting
                ? "text-accent"
                : isError
                  ? "text-white"
                  : "text-text-muted",
          )}
        >
          <Mic size={28} strokeWidth={1.5} aria-hidden="true" />
        </div>
      </button>
      {isIdle && (
        <span className="select-none text-[11px] text-text-muted">
          Press{" "}
          <kbd className="rounded border border-border-hover bg-border px-1 py-0.5 font-mono text-[11px]">
            Space
          </kbd>{" "}
          to start
        </span>
      )}
    </div>
  );
}
