import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the handlers createTauriApi registers so we can drive them directly.
const handlers = new Map<string, (event: { payload: unknown }) => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    handlers.set(name, cb);
    return () => handlers.delete(name);
  }),
  emit: vi.fn(),
}));

import { createTauriApi } from "@/api-tauri";
import type { STTEvent } from "@/api";

async function collect() {
  const api = createTauriApi();
  const events: STTEvent[] = [];
  api.onEvent((e) => events.push(e));
  await api.spawn();
  return events;
}

describe("output/cleanup failure surfacing", () => {
  beforeEach(() => handlers.clear());

  // These two events were emitted by the Rust backend but never listened for,
  // so a missing typing tool or a failed cleanup was invisible to the user.
  it("listens for output_error and llm_error", async () => {
    await collect();
    expect(handlers.has("output_error")).toBe(true);
    expect(handlers.has("llm_error")).toBe(true);
  });

  it("maps output_error to a general error event", async () => {
    const events = await collect();
    handlers.get("output_error")!({ payload: { error: "xdotool not found" } });
    expect(events).toContainEqual({
      type: "error",
      category: "general",
      message: "xdotool not found",
    });
  });

  it("maps llm_error to a general error event", async () => {
    const events = await collect();
    handlers.get("llm_error")!({ payload: { error: "cleanup failed" } });
    expect(events).toContainEqual({
      type: "error",
      category: "general",
      message: "cleanup failed",
    });
  });

  it("falls back to a readable message when the payload has none", async () => {
    const events = await collect();
    handlers.get("output_error")!({ payload: {} });
    expect(events).toContainEqual({
      type: "error",
      category: "general",
      message: "Unknown error",
    });
  });
});
