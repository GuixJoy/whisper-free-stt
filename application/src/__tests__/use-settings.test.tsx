import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const invoke = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { useSettings } from "@/hooks/useSettings";
import { DEFAULT_LLM_MODEL, LOCAL_STORAGE_KEY, SETTINGS_VERSION } from "@/lib/settings";

function callsTo(cmd: string) {
  return invoke.mock.calls.filter((c) => c[0] === cmd);
}

describe("useSettings", () => {
  beforeEach(() => {
    invoke.mockClear();
    localStorage.clear();
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

    const payload = callsTo("set_floure_config")[0][1] as { update: { llm_model: string } };
    expect(payload.update.llm_model).toBe(DEFAULT_LLM_MODEL);
    expect(payload.update.llm_model).not.toBe("");
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

    const raw = localStorage.getItem(LOCAL_STORAGE_KEY)!;
    const parsed = JSON.parse(raw);
    expect(parsed.__version).toBe(SETTINGS_VERSION);
    expect(parsed).not.toHaveProperty("openrouterApiKey");
  });

  it("updateSettings merges a patch", async () => {
    const { result } = renderHook(() => useSettings());
    result.current.updateSettings({ llmModel: "gemma-3-1b-it-q4_k_m" });
    await waitFor(() => expect(result.current.settings.llmModel).toBe("gemma-3-1b-it-q4_k_m"));

    // and the change is what gets synced
    await waitFor(() => {
      const last = callsTo("set_floure_config").at(-1)![1] as { update: { llm_model: string } };
      expect(last.update.llm_model).toBe("gemma-3-1b-it-q4_k_m");
    });
  });
});
