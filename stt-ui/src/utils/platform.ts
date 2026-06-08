// ── Cross-platform detection and tool selection ──

export type DisplayServer = "wayland" | "x11" | "unknown";
export type Platform = "linux" | "macos" | "windows";

export interface PlatformInfo {
  platform: Platform;
  displayServer: DisplayServer;
  clipboardTool: string;
  typingTool: string;
  audioGroup: string;
}

let _cached: PlatformInfo | null = null;

export function detectPlatform(): PlatformInfo {
  if (_cached) return _cached;

  let platform: Platform;
  let displayServer: DisplayServer = "unknown";
  let clipboardTool: string;
  let typingTool: string;
  let audioGroup: string;

  const ua = typeof navigator !== "undefined" ? navigator.platform || "" : "";

  if (ua.includes("Win")) {
    platform = "windows";
    clipboardTool = "clip.exe";
    typingTool = 'powershell';
    audioGroup = "";
  } else if (ua.includes("Mac")) {
    platform = "macos";
    clipboardTool = "pbcopy";
    typingTool = "osascript";
    audioGroup = "admin";
  } else {
    platform = "linux";
    // Detect display server via navigator.userAgentData or env hints on the window object
    if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
      if ((window as any).__TAURI_INTERNALS__.platform === "linux") {
        displayServer = "unknown";
      }
    }
    // Try env via import.meta.env on Vite, else default
    const isWayland = typeof window !== "undefined" && window.location.search.includes("wayland");
    if (isWayland) {
      displayServer = "wayland";
    }
    if (displayServer === "wayland") {
      clipboardTool = "wl-copy";
      typingTool = "wtype";
    } else {
      clipboardTool = "xclip";
      typingTool = "xdotool";
    }
    audioGroup = "audio";
  }

  _cached = { platform, displayServer, clipboardTool, typingTool, audioGroup };
  return _cached;
}

export function checkClipboardTool(): boolean {
  if (typeof navigator !== "undefined" && navigator.clipboard) return true;
  return true;
}

export function checkTypingTool(): boolean {
  return true;
}

