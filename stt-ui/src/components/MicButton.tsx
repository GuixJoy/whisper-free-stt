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
          "bg-[#11161D] border-2 border-[#EF4444]",
          "shadow-[0_0_40px_rgba(239,68,68,0.25)]",
        ],
        isListening && [
          "bg-[#C7772C] border-2 border-[#C7772C]",
          "shadow-[0_0_40px_rgba(199,119,44,0.35)]",
          "animate-mic-pulse",
        ],
        isTranscribing && [
          "bg-[#C7772C] border-2 border-[#C7772C]",
          "shadow-[0_0_40px_rgba(199,119,44,0.35)]",
          "animate-mic-pulse",
        ],
        isRewriting && [
          "bg-[#C7772C] border-2 border-[#C7772C]",
          "shadow-[0_0_40px_rgba(199,119,44,0.35)]",
          "animate-mic-pulse",
        ],
        isIdle && [
          "bg-[#11161D] border-2 border-white/[0.08]",
          "hover:border-white/[0.15] hover:bg-[#151B24]",
        ],
      )}
      aria-label={connected ? "Stop transcription" : "Start transcription"}
    >
      <div
        className={cn(
          "transition-all duration-300",
          isActive || isError ? "text-white" : "text-[#7A7F87]",
        )}
      >
        {connected ? <Mic size={28} strokeWidth={1.5} /> : <MicOff size={28} strokeWidth={1.5} />}
      </div>
    </button>
  );
}
