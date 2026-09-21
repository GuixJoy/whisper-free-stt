import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * Modal built on the native <dialog> element. Focus trap, Escape-to-close,
 * inert background and top-layer stacking come from the platform, so there is
 * no hand-rolled key handling and no dependency.
 *
 * Mount-driven: render it only while open (the existing `if (!visible) return
 * null` pattern). Remounting also resets child form state, which the dictionary
 * entry modal relies on.
 */
export default function Dialog({ onClose, label, className, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.open) return;
    // jsdom does not implement showModal; fall back to the attribute so the
    // element still carries its implicit `dialog` role under test.
    if (typeof el.showModal === "function") el.showModal();
    else el.setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-modal="true"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        // fixed+inset-0+m-auto is what actually centers a modal dialog:
        // without offsets, top resolves to the static position (below the fold).
        "fixed inset-0 m-auto w-[calc(100%-2rem)] rounded-[14px] border border-border bg-white p-0 text-text-primary shadow-lg",
        className,
      )}
    >
      {children}
    </dialog>
  );
}
