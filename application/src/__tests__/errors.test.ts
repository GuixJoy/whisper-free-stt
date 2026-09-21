import { describe, it, expect } from "vitest";
import { parseAppError, categoryForKind } from "@/lib/errors";

describe("parseAppError", () => {
  // Rust's AppError now serializes as { kind, message } (see ErrorPayload).
  it("passes through the structural Rust payload", () => {
    expect(parseAppError({ kind: "config", message: "Config error: denied" })).toEqual({
      kind: "config",
      message: "Config error: denied",
    });
  });

  // Commands that still return Result<_, String> reject with a bare string.
  it("handles a legacy bare string", () => {
    expect(parseAppError("plain failure")).toEqual({
      kind: "unknown",
      message: "plain failure",
    });
  });

  it("handles a JS Error", () => {
    expect(parseAppError(new Error("boom"))).toEqual({ kind: "unknown", message: "boom" });
  });

  it("never throws on odd shapes", () => {
    expect(parseAppError(undefined).kind).toBe("unknown");
    expect(parseAppError(null).kind).toBe("unknown");
    expect(parseAppError(42).message).toBe("42");
    // Malformed: kind present but not a string, message missing.
    expect(parseAppError({ kind: 7 }).kind).toBe("unknown");
  });

  // The whole point of the structural shape: nothing may stringify to
  // "[object Object]".
  it("never yields an object-repr message", () => {
    const parsed = parseAppError({ kind: "io", message: "IO error: missing" });
    expect(parsed.message).not.toContain("[object");
  });
});

describe("categoryForKind", () => {
  it("maps Rust variants to banner categories", () => {
    expect(categoryForKind("tauri")).toBe("connection");
    expect(categoryForKind("audio")).toBe("mic");
    expect(categoryForKind("database")).toBe("general");
    expect(categoryForKind("config")).toBe("general");
    expect(categoryForKind("io")).toBe("general");
  });

  it("falls back to general for unknown kinds", () => {
    expect(categoryForKind("nonsense")).toBe("general");
    expect(categoryForKind("unknown")).toBe("general");
  });
});
