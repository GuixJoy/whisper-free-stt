/**
 * Cross-platform clipboard write. Uses Tauri clipboard plugin when available,
 * falls back to the browser Clipboard API.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Try Tauri clipboard plugin first (works in webview without HTTPS)
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    }
    // Fallback to browser API
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
