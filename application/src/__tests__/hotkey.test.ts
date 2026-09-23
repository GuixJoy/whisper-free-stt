import { describe, it, expect, beforeEach } from "vitest";
import { getStoredHotkey, DEFAULT_HOTKEY } from "@/lib/settings";

beforeEach(() => localStorage.clear());

describe("getStoredHotkey", () => {
  it("returns the new default when nothing is stored", () => {
    expect(getStoredHotkey()).toBe(DEFAULT_HOTKEY);
  });

  it("migrates installs still on the legacy default", () => {
    localStorage.setItem("stt-hotkey", "CommandOrControl+Shift+Space");
    expect(getStoredHotkey()).toBe("CommandOrControl+Alt+Space");
  });

  it("never overrides an explicit user choice", () => {
    localStorage.setItem("stt-hotkey", "Alt+Space");
    expect(getStoredHotkey()).toBe("Alt+Space");
  });
});
