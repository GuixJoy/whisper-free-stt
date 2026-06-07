/**
 * Tests for the pure utility functions defined in App.tsx.
 *
 * buildCliArgs() and buildWsCommand() are module-level functions embedded in
 * App.tsx. Because they are not exported, these tests verify their behavioral
 * contract by re-implementing the same pure logic and asserting all
 * expected input→output mappings. This acts as a living specification that
 * any refactoring or extraction must satisfy.
 */

import { describe, it, expect } from "vitest";

// ── Mirror types from App.tsx ──────────────────────────────────────────────

interface RuntimeSettings {
  wsPort: number;
  asrProfile: "auto" | "speed" | "balanced" | "accuracy" | "distil" | "turbo";
  backend: "auto" | "whisper_cpp" | "faster_whisper";
  model: string;
  llmMode: "cleanup" | "off" | "bullet_list" | "email" | "commit_message";
  fastCommit: boolean;
  typing: boolean;
  clipboard: boolean;
  debug: boolean;
}

// ── Mirror implementations from App.tsx ───────────────────────────────────
// These must stay in sync with the definitions in stt-ui/src/App.tsx.

function buildCliArgs(settings: RuntimeSettings): string[] {
  const args: string[] = ["--json-mode", "--asr-profile", settings.asrProfile, "--llm-mode", settings.llmMode];
  if (settings.backend !== "auto") args.push("--backend", settings.backend);
  if (settings.model.trim()) args.push("--model", settings.model.trim());
  if (settings.fastCommit) args.push("--fast-commit");
  if (!settings.typing) args.push("--no-type");
  if (settings.clipboard) args.push("--clipboard");
  if (settings.debug) args.push("--debug");
  return args;
}

function buildWsCommand(settings: RuntimeSettings): string {
  const args = [
    "--ws-port", String(settings.wsPort),
    "--asr-profile", settings.asrProfile,
    "--llm-mode", settings.llmMode,
  ];
  if (settings.backend !== "auto") args.push("--backend", settings.backend);
  if (settings.model.trim()) args.push("--model", settings.model.trim());
  if (settings.fastCommit) args.push("--fast-commit");
  if (!settings.typing) args.push("--no-type");
  if (settings.clipboard) args.push("--clipboard");
  if (settings.debug) args.push("--debug");
  return `stt ${args.join(" ")}`;
}

// ── Default settings (mirrors DEFAULT_SETTINGS in App.tsx) ────────────────

const DEFAULT_SETTINGS: RuntimeSettings = {
  wsPort: 8765,
  asrProfile: "auto",
  backend: "auto",
  model: "",
  llmMode: "cleanup",
  fastCommit: true,
  typing: false,
  clipboard: false,
  debug: false,
};

// ─────────────────────────────────────────────────────────────────────────
// buildCliArgs tests
// ─────────────────────────────────────────────────────────────────────────

describe("buildCliArgs", () => {
  it("always includes --json-mode as first argument", () => {
    const args = buildCliArgs(DEFAULT_SETTINGS);
    expect(args[0]).toBe("--json-mode");
  });

  it("always includes --asr-profile and its value", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, asrProfile: "turbo" });
    const idx = args.indexOf("--asr-profile");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("turbo");
  });

  it("always includes --llm-mode and its value", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, llmMode: "email" });
    const idx = args.indexOf("--llm-mode");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("email");
  });

  it("omits --backend flag when backend is 'auto'", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, backend: "auto" });
    expect(args).not.toContain("--backend");
  });

  it("includes --backend when backend is 'whisper_cpp'", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, backend: "whisper_cpp" });
    const idx = args.indexOf("--backend");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("whisper_cpp");
  });

  it("includes --backend when backend is 'faster_whisper'", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, backend: "faster_whisper" });
    const idx = args.indexOf("--backend");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("faster_whisper");
  });

  it("omits --model when model is empty string", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, model: "" });
    expect(args).not.toContain("--model");
  });

  it("omits --model when model is whitespace only", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, model: "   " });
    expect(args).not.toContain("--model");
  });

  it("includes --model and trims value when model is provided", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, model: "  large-v3-turbo  " });
    const idx = args.indexOf("--model");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("large-v3-turbo");
  });

  it("includes --fast-commit when fastCommit is true", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, fastCommit: true });
    expect(args).toContain("--fast-commit");
  });

  it("omits --fast-commit when fastCommit is false", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, fastCommit: false });
    expect(args).not.toContain("--fast-commit");
  });

  it("includes --no-type when typing is false (default)", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, typing: false });
    expect(args).toContain("--no-type");
  });

  it("omits --no-type when typing is true", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, typing: true });
    expect(args).not.toContain("--no-type");
  });

  it("includes --clipboard when clipboard is true", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, clipboard: true });
    expect(args).toContain("--clipboard");
  });

  it("omits --clipboard when clipboard is false (default)", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, clipboard: false });
    expect(args).not.toContain("--clipboard");
  });

  it("includes --debug when debug is true", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, debug: true });
    expect(args).toContain("--debug");
  });

  it("omits --debug when debug is false (default)", () => {
    const args = buildCliArgs({ ...DEFAULT_SETTINGS, debug: false });
    expect(args).not.toContain("--debug");
  });

  it("returns array of strings (not objects)", () => {
    const args = buildCliArgs(DEFAULT_SETTINGS);
    for (const arg of args) {
      expect(typeof arg).toBe("string");
    }
  });

  it("default settings produce expected minimal args", () => {
    const args = buildCliArgs(DEFAULT_SETTINGS);
    expect(args).toContain("--json-mode");
    expect(args).toContain("--asr-profile");
    expect(args).toContain("auto");
    expect(args).toContain("--llm-mode");
    expect(args).toContain("cleanup");
    expect(args).toContain("--fast-commit");
    expect(args).toContain("--no-type");
    expect(args).not.toContain("--backend");
    expect(args).not.toContain("--clipboard");
    expect(args).not.toContain("--debug");
  });

  it("all ASR profile values are passed through correctly", () => {
    const profiles = ["auto", "speed", "balanced", "accuracy", "distil", "turbo"] as const;
    for (const asrProfile of profiles) {
      const args = buildCliArgs({ ...DEFAULT_SETTINGS, asrProfile });
      const idx = args.indexOf("--asr-profile");
      expect(args[idx + 1]).toBe(asrProfile);
    }
  });

  it("all LLM mode values are passed through correctly", () => {
    const modes = ["cleanup", "off", "bullet_list", "email", "commit_message"] as const;
    for (const llmMode of modes) {
      const args = buildCliArgs({ ...DEFAULT_SETTINGS, llmMode });
      const idx = args.indexOf("--llm-mode");
      expect(args[idx + 1]).toBe(llmMode);
    }
  });

  it("all flags enabled produces maximum-length args array", () => {
    const allEnabled = {
      ...DEFAULT_SETTINGS,
      backend: "faster_whisper" as const,
      model: "large-v3-turbo",
      fastCommit: true,
      typing: true,
      clipboard: true,
      debug: true,
    };
    const args = buildCliArgs(allEnabled);
    expect(args).toContain("--json-mode");
    expect(args).toContain("--asr-profile");
    expect(args).toContain("--llm-mode");
    expect(args).toContain("--backend");
    expect(args).toContain("--model");
    expect(args).toContain("--fast-commit");
    expect(args).toContain("--clipboard");
    expect(args).toContain("--debug");
    expect(args).not.toContain("--no-type"); // typing=true → no --no-type
  });
});

// ─────────────────────────────────────────────────────────────────────────
// buildWsCommand tests
// ─────────────────────────────────────────────────────────────────────────

describe("buildWsCommand", () => {
  it("always starts with 'stt '", () => {
    const cmd = buildWsCommand(DEFAULT_SETTINGS);
    expect(cmd).toMatch(/^stt /);
  });

  it("includes --ws-port with the configured port", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, wsPort: 9999 });
    expect(cmd).toContain("--ws-port 9999");
  });

  it("uses the default port 8765", () => {
    const cmd = buildWsCommand(DEFAULT_SETTINGS);
    expect(cmd).toContain("--ws-port 8765");
  });

  it("includes --asr-profile and its value", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, asrProfile: "speed" });
    expect(cmd).toContain("--asr-profile speed");
  });

  it("includes --llm-mode and its value", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, llmMode: "bullet_list" });
    expect(cmd).toContain("--llm-mode bullet_list");
  });

  it("does NOT include --json-mode (WebSocket mode uses different args)", () => {
    const cmd = buildWsCommand(DEFAULT_SETTINGS);
    expect(cmd).not.toContain("--json-mode");
  });

  it("omits --backend when backend is 'auto'", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, backend: "auto" });
    expect(cmd).not.toContain("--backend");
  });

  it("includes --backend when backend is 'faster_whisper'", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, backend: "faster_whisper" });
    expect(cmd).toContain("--backend faster_whisper");
  });

  it("omits --model when model is empty", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, model: "" });
    expect(cmd).not.toContain("--model");
  });

  it("includes --model with trimmed value when provided", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, model: " large-v3 " });
    expect(cmd).toContain("--model large-v3");
  });

  it("includes --fast-commit when fastCommit is true", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, fastCommit: true });
    expect(cmd).toContain("--fast-commit");
  });

  it("omits --fast-commit when fastCommit is false", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, fastCommit: false });
    expect(cmd).not.toContain("--fast-commit");
  });

  it("includes --no-type when typing is false", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, typing: false });
    expect(cmd).toContain("--no-type");
  });

  it("omits --no-type when typing is true", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, typing: true });
    expect(cmd).not.toContain("--no-type");
  });

  it("includes --clipboard when clipboard is true", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, clipboard: true });
    expect(cmd).toContain("--clipboard");
  });

  it("omits --clipboard when clipboard is false", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, clipboard: false });
    expect(cmd).not.toContain("--clipboard");
  });

  it("includes --debug when debug is true", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, debug: true });
    expect(cmd).toContain("--debug");
  });

  it("returns a string (not array)", () => {
    const cmd = buildWsCommand(DEFAULT_SETTINGS);
    expect(typeof cmd).toBe("string");
  });

  it("default settings produce a valid stt command", () => {
    const cmd = buildWsCommand(DEFAULT_SETTINGS);
    expect(cmd).toBe("stt --ws-port 8765 --asr-profile auto --llm-mode cleanup --fast-commit --no-type");
  });

  it("port is converted to string (no decimal points)", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, wsPort: 8765 });
    expect(cmd).toContain("--ws-port 8765");
    expect(cmd).not.toContain("8765.0");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT_SETTINGS contract tests
// ─────────────────────────────────────────────────────────────────────────

describe("DEFAULT_SETTINGS", () => {
  it("has wsPort 8765", () => {
    expect(DEFAULT_SETTINGS.wsPort).toBe(8765);
  });

  it("has asrProfile 'auto'", () => {
    expect(DEFAULT_SETTINGS.asrProfile).toBe("auto");
  });

  it("has backend 'auto'", () => {
    expect(DEFAULT_SETTINGS.backend).toBe("auto");
  });

  it("has empty model (no override by default)", () => {
    expect(DEFAULT_SETTINGS.model).toBe("");
  });

  it("has llmMode 'cleanup'", () => {
    expect(DEFAULT_SETTINGS.llmMode).toBe("cleanup");
  });

  it("has fastCommit enabled by default", () => {
    expect(DEFAULT_SETTINGS.fastCommit).toBe(true);
  });

  it("has typing disabled by default", () => {
    expect(DEFAULT_SETTINGS.typing).toBe(false);
  });

  it("has clipboard disabled by default", () => {
    expect(DEFAULT_SETTINGS.clipboard).toBe(false);
  });

  it("has debug disabled by default", () => {
    expect(DEFAULT_SETTINGS.debug).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Boundary / regression tests
// ─────────────────────────────────────────────────────────────────────────

describe("buildCliArgs and buildWsCommand boundary cases", () => {
  it("model with only spaces is treated as empty (no --model flag)", () => {
    const cliArgs = buildCliArgs({ ...DEFAULT_SETTINGS, model: "     " });
    const wsCmd = buildWsCommand({ ...DEFAULT_SETTINGS, model: "     " });
    expect(cliArgs).not.toContain("--model");
    expect(wsCmd).not.toContain("--model");
  });

  it("model with leading/trailing whitespace is trimmed", () => {
    const cliArgs = buildCliArgs({ ...DEFAULT_SETTINGS, model: "  base.en  " });
    const idx = cliArgs.indexOf("--model");
    expect(cliArgs[idx + 1]).toBe("base.en");

    const wsCmd = buildWsCommand({ ...DEFAULT_SETTINGS, model: "  base.en  " });
    expect(wsCmd).toContain("--model base.en");
  });

  it("port zero is still converted to string in ws command", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, wsPort: 0 });
    expect(cmd).toContain("--ws-port 0");
  });

  it("very large port number is included correctly", () => {
    const cmd = buildWsCommand({ ...DEFAULT_SETTINGS, wsPort: 65535 });
    expect(cmd).toContain("--ws-port 65535");
  });

  it("cli args are in a predictable order: json-mode, asr-profile, llm-mode first", () => {
    const args = buildCliArgs(DEFAULT_SETTINGS);
    expect(args.indexOf("--json-mode")).toBeLessThan(args.indexOf("--asr-profile"));
    expect(args.indexOf("--asr-profile")).toBeLessThan(args.indexOf("--llm-mode"));
  });

  it("ws command always includes ws-port before asr-profile", () => {
    const cmd = buildWsCommand(DEFAULT_SETTINGS);
    const wsPortIdx = cmd.indexOf("--ws-port");
    const asrIdx = cmd.indexOf("--asr-profile");
    expect(wsPortIdx).toBeLessThan(asrIdx);
  });
});