import { useEffect, useCallback } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface MicPermissionModalProps {
  visible: boolean;
  onOpenConfig: () => void;
  onClose: () => void;
}

export default function MicPermissionModal({ visible, onOpenConfig, onClose }: MicPermissionModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (visible) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(44,37,32,0.4)] backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Microphone permission required"
    >
      <div className="bg-white rounded-[14px] border border-border w-full max-w-[380px] shadow-lg overflow-hidden">
        {/* Icon */}
        <div className="flex items-center justify-center pt-6 pb-2">
          <div className="flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-accent-surface">
            <Mic size={22} className="text-accent" />
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 text-center">
          <h2 className="text-[16px] font-semibold text-text-primary mb-2">
            Microphone Access Required
          </h2>
          <p className="text-[13px] text-text-muted leading-relaxed mb-5">
            Floure needs microphone access to transcribe your speech.
            Enable microphone access in Config before using voice recognition.
          </p>

          {/* Buttons */}
          <div className="flex gap-2.5">
            <button
              onClick={onClose}
              className={cn(
                "flex-1 h-[36px] rounded-[8px] text-[13px] font-medium transition-colors",
                "bg-app-surface-secondary border border-border text-text-secondary",
                "hover:bg-app-hover",
              )}
            >
              Cancel
            </button>
            <button
              onClick={onOpenConfig}
              className={cn(
                "flex-1 h-[36px] rounded-[8px] text-[13px] font-medium transition-colors",
                "bg-accent text-white",
                "hover:bg-accent-warm",
              )}
            >
              Open Config
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
