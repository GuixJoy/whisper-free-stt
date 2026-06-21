import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  featureName: string;
  toolName: string;
  platformNote: string;
  children: React.ReactNode;
}

export default function PermissionGate({ featureName, toolName, platformNote, children }: Props) {
  const [granted, setGranted] = useState(true);

  if (!granted) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 rounded-card bg-app-surface border border-border text-center">
        <div className="text-4xl">🔒</div>
        <strong className="text-body text-text-primary">{featureName}</strong>
        <p className="text-body text-text-secondary">Requires {toolName} on your system</p>
        <p className="text-small text-text-muted">{platformNote}</p>
        <button
          className={cn(
            "inline-flex items-center justify-center rounded-button h-8 px-3 text-small font-medium transition-all duration-200",
            "bg-app-surface border border-border text-text-primary hover:bg-app-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30",
          )}
          onClick={() => setGranted(true)}
        >
          Continue Anyway
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
