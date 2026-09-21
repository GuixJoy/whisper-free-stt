// ── Tauri command errors: structural wire shape ──
//
// Rust's `AppError` serializes as `{ kind, message }` (see ErrorPayload in
// lib.rs), so the UI can branch on the variant instead of matching on
// human-readable text. Older/other failures may still arrive as a plain string
// or a JS Error, so both shapes are handled.

export interface TauriAppError {
  kind: string;
  message: string;
}

/** Error-banner categories, mirroring AppError["category"]. */
export type ErrorCategory = "connection" | "model" | "mic" | "permission" | "general";

/**
 * Normalise anything `invoke` can reject with into `{ kind, message }`.
 * Never throws: an unrecognised shape becomes kind "unknown".
 */
export function parseAppError(e: unknown): TauriAppError {
  if (typeof e === "object" && e !== null && "kind" in e && "message" in e) {
    const { kind, message } = e as { kind: unknown; message: unknown };
    return {
      kind: typeof kind === "string" ? kind : "unknown",
      message: typeof message === "string" ? message : String(message),
    };
  }
  if (e instanceof Error) return { kind: "unknown", message: e.message };
  if (typeof e === "string") return { kind: "unknown", message: e };
  return { kind: "unknown", message: String(e) };
}

/**
 * Map a Rust error variant onto an error-banner category, so the badge reflects
 * the actual cause rather than everything landing under one label.
 */
export function categoryForKind(kind: string): ErrorCategory {
  switch (kind) {
    case "audio":
      return "mic";
    case "tauri":
      return "connection";
    case "database":
    case "io":
    case "config":
      return "general";
    default:
      return "general";
  }
}
