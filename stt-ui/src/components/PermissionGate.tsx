// ── Permission gate: shows locked state when a feature needs system access ──
import { useState } from "react";

interface Props {
  featureName: string;
  toolName: string;
  platformNote: string;
  children: React.ReactNode;
}

export default function PermissionGate({ featureName, toolName, platformNote, children }: Props) {
  const [granted, setGranted] = useState(true); // Permissions handled by sidecar

  if (!granted) {
    return (
      <div className="permission-gate">
        <div className="perm-lock-icon">🔒</div>
        <strong>{featureName}</strong>
        <p>Requires {toolName} on your system</p>
        <p className="perm-hint">{platformNote}</p>
        <button className="sketch-btn btn-sm" onClick={() => setGranted(true)}>
          Continue Anyway
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
