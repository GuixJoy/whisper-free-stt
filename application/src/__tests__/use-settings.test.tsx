import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

type InvokeCall = [cmd: string, args?: unknown];
const invoke = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_LLM_MODEL, LOCAL_STORAGE_KEY, SETTINGS_VERSION } from "@/lib/settings";

function callsTo(cmd: string): InvokeCall[] {
  return invoke.mock.calls.filter((c) => c[0] === cmd) as InvokeCall[];
}

function lastPayload(cmd: string) {
  const calls = callsTo(cmd);
  return calls[calls.length - 1]?.[1] as { update: { llm_model: string } } | undefined;
}

describe("useSettings", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation(() => Promise.resolve());
    localStorage.clear();
    // The hook only talks to the backend inside Tauri; simulate that here.
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  it("pushes settings to the backend on mount", async () => {
    renderHook(() => useSettings());
    await waitFor(() => expect(callsTo("set_floure_config").length).toBeGreaterThan(0));
  });

  // The regression this hook exists to prevent: the UI's default llmModel is
  // "", which resolves to models/""/file.gguf on the Rust side, so a
  // downloaded model reports "Local LLM model not loaded".
  it("never syncs an empty llm_model", async () => {
    renderHook(() => useSettings());
    await waitFor(() => expect(callsTo("set_floure_config").length).toBeGreaterThan(0));

    const payload = lastPayload("set_floure_config");
    expect(payload?.update.llm_model).toBe(DEFAULT_LLM_MODEL);
    expect(payload?.update.llm_model).not.toBe("");
  });

  // Guard against the tempting "abort the sync when a field looks empty"
  // shortcut: an empty API key is normal for local-provider users, so the
  // sync must still happen.
  it("still syncs when the API key is empty (local provider)", async () => {
    renderHook(() => useSettings());
    await waitFor(() => expect(callsTo("set_floure_config").length).toBeGreaterThan(0));
    expect(callsTo("set_openrouter_api_key").length).toBeGreaterThan(0);
  });

  it("persists settings without the API key", async () => {
    renderHook(() => useSettings());
    await waitFor(() => expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeTruthy());

    const parsed = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)!);
    expect(parsed.__version).toBe(SETTINGS_VERSION);
    expect(parsed).not.toHaveProperty("openrouterApiKey");
  });

  it("updateSettings merges a patch and syncs it", async () => {
    const { result } = renderHook(() => useSettings());
    result.current.updateSettings({ llmModel: "gemma-3-1b-it-q4_k_m" });
    await waitFor(() => expect(result.current.settings.llmModel).toBe("gemma-3-1b-it-q4_k_m"));

    await waitFor(() => {
      expect(lastPayload("set_floure_config")?.update.llm_model).toBe("gemma-3-1b-it-q4_k_m");
    });
  });

  // A failed push leaves the backend on a stale config; it must not be
  // swallowed the way web mode is.
  it("exposes syncError when the backend push fails", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("ipc exploded")));
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.syncError).toBe("ipc exploded"));
  });

  it("does not report an error in web mode (no Tauri)", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(localStorage.getItem(LOCAL_STORAGE_KEY)).toBeTruthy());
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.syncError).toBeNull();
  });
});
