import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import Dialog from "./Dialog";

interface MicPermissionModalProps {
  visible: boolean;
  onOpenConfig: () => void;
  onClose: () => void;
}

export default function MicPermissionModal({ visible, onOpenConfig, onClose }: MicPermissionModalProps) {
  if (!visible) return null;

  return (
    <Dialog onClose={onClose} label="Microphone permission required" className="max-w-[380px] overflow-hidden">
      {/* Icon */}
        <div className="flex items-center justify-center pt-6 pb-2">
          <div className="flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-accent-surface">
            <Mic size={22} className="text-accent" />
          </div>
        </div>

        {/* Content */}
        <div className="px-6 pb-6 text-center">
          <h2 className="text-balance text-[16px] font-semibold text-text-primary mb-2">
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
    </Dialog>
  );
}
