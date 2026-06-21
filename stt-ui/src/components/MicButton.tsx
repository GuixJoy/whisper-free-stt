import { Mic, MicOff } from "lucide-react";
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
  const isActive = isListening || isTranscribing || isRewriting;

  return (
    <button
      onClick={onToggle}
      className={cn(
        "relative flex items-center justify-center rounded-full transition-all duration-300",
        "w-[80px] h-[80px]",
        isError && [
          "bg-app-surface-secondary border-2 border-[#EF4444]",
          "shadow-[0_0_40px_rgba(239,68,68,0.25)]",
        ],
        isListening && [
          "bg-accent border-2 border-accent",
          "shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.08)]",
          "animate-mic-pulse",
        ],
        isTranscribing && [
          "bg-accent border-2 border-accent",
          "shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.08)]",
          "animate-mic-pulse",
        ],
        isRewriting && [
          "bg-accent border-2 border-accent",
          "shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.08)]",
          "animate-mic-pulse",
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
          "transition-all duration-300",
          isActive || isError ? "text-white" : "text-text-muted",
        )}
      >
        {connected ? <Mic size={28} strokeWidth={1.5} /> : <MicOff size={28} strokeWidth={1.5} />}
      </div>
    </button>
  );
}
