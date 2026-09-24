import { describe, it, expect, beforeEach } from "vitest";
import { getStoredHotkey, DEFAULT_HOTKEY } from "@/lib/settings";

beforeEach(() => localStorage.clear());

describe("getStoredHotkey", () => {
  it("returns the new default when nothing is stored", () => {
    expect(getStoredHotkey()).toBe(DEFAULT_HOTKEY);
  });

  it("migrates installs still on a legacy default", () => {
    for (const legacy of [
      "CommandOrControl+Shift+Space",
      "CommandOrControl+Alt+Space",
      "CommandOrControl+Shift+K",
    ]) {
      // Each case needs the pre-migration state: the migration runs once, so
      // without this reset only the first legacy value would be migrated.
      localStorage.clear();
      localStorage.setItem("stt-hotkey", legacy);
      expect(getStoredHotkey()).toBe(DEFAULT_HOTKEY);
    }
  });

  it("keeps a legacy combo the user picks after the migration ran", () => {
    getStoredHotkey(); // runs the one-time migration
    localStorage.setItem("stt-hotkey", "CommandOrControl+Shift+K");
    expect(getStoredHotkey()).toBe("CommandOrControl+Shift+K");
  });

  it("never overrides an explicit user choice", () => {
    localStorage.setItem("stt-hotkey", "Alt+Space");
    expect(getStoredHotkey()).toBe("Alt+Space");
  });
});
