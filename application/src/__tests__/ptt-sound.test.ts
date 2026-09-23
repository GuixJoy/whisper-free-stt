import { describe, it, expect } from "vitest";
import { playPttStart, playPttStop } from "@/lib/ptt-sound";

describe("ptt-sound", () => {
  it("never throws, even without AudioContext (jsdom has none)", () => {
    expect(() => playPttStart()).not.toThrow();
    expect(() => playPttStop()).not.toThrow();
  });
});
