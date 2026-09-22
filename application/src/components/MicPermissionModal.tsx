import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import Dialog from "./Dialog";

interface MicPermissionModalProps {
  visible: boolean;
  onOpenConfig: () => void;
  onClose: () => void;
}

export default function MicPermissionModal({
  visible,
  onOpenConfig,
  onClose,
}: MicPermissionModalProps) {
  if (!visible) return null;

  return (
    <Dialog
      onClose={onClose}
      label="Microphone permission required"
      className="max-w-[380px] overflow-hidden"
    >
      {/* Icon */}
      <div className="flex items-center justify-center pb-2 pt-6">
        <div className="flex h-[48px] w-[48px] items-center justify-center rounded-[12px] bg-accent-surface">
          <Mic size={22} className="text-accent" />
        </div>
      </div>

      {/* Content */}
      <div className="px-6 pb-6 text-center">
        <h2 className="mb-2 text-balance text-[16px] font-semibold text-text-primary">
          Microphone Access Required
        </h2>
        <p className="mb-5 text-[13px] leading-relaxed text-text-muted">
          Floure needs microphone access to transcribe your speech. Enable microphone access in
          Config before using voice recognition.
        </p>

        {/* Buttons */}
        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className={cn(
              "h-[36px] flex-1 rounded-[8px] text-[13px] font-medium transition-colors",
              "border border-border bg-app-surface-secondary text-text-secondary",
              "hover:bg-app-hover",
            )}
          >
            Cancel
          </button>
          <button
            onClick={onOpenConfig}
            className={cn(
              "h-[36px] flex-1 rounded-[8px] text-[13px] font-medium transition-colors",
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
