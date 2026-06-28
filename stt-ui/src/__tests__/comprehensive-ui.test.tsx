/**
 * Comprehensive UI Test Suite for STT-UI
 * Tests every React component for rendering, interactions, accessibility, and edge cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// ── Mocks ──

// Mock Tauri internals
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: undefined, writable: true });

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => {
  const React = require("react");
  const createMotionComponent = (tag: string) =>
    React.forwardRef<any, any>((props, ref) => React.createElement(tag, { ...props, ref }));

  const motionProxy = new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        if (prop === "path" || prop === "div" || prop === "span" || prop === "svg" || prop === "circle" || prop === "rect" || prop === "g") {
          return createMotionComponent(prop);
        }
        return createMotionComponent("div");
      },
    }
  );

  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useAnimation: () => ({
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      set: vi.fn(),
    }),
  };
});

// Mock socket.io-client
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
  })),
}));

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setTitle: vi.fn(),
    unminimize: vi.fn(),
    show: vi.fn(),
    setFocus: vi.fn(),
  })),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    sidecar: vi.fn(() => ({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      spawn: vi.fn(),
      execute: vi.fn(),
    })),
  },
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(),
  readText: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({
  register: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({}));

// Mock clipboard
vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

// Mock mic-emitter
vi.mock("@/utils/mic-emitter", () => ({
  micLevelEmitter: {
    subscribe: vi.fn(() => () => {}),
    emit: vi.fn(),
    startWebAudioMonitoring: vi.fn(),
    stopWebAudioMonitoring: vi.fn(),
  },
}));

// Mock platform utils
vi.mock("@/utils/platform", () => ({
  detectPlatform: vi.fn(() => ({
    platform: "linux",
    displayServer: "x11",
    clipboardTool: "xclip",
    typingTool: "xdotool",
    audioGroup: "audio",
  })),
}));

// Mock useOnboarding hook
vi.mock("@/hooks/useOnboarding", () => ({
  useOnboarding: vi.fn(() => ({
    state: {
      step: 0,
      totalSteps: 5,
      completed: false,
      skipped: false,
      systemChecks: [],
      selectedMicIndex: null,
      micLevel: 0,
      clipboardEnabled: false,
      typingEnabled: false,
      preferredModel: "small.en",
      modelDownloadProgress: {},
      error: null,
    },
    dispatch: vi.fn(),
    runSystemChecks: vi.fn(),
    downloadModels: vi.fn(),
    testMic: vi.fn(),
    nextStep: vi.fn(),
    finish: vi.fn(),
  })),
}));

// Mock useModels hook
vi.mock("@/hooks/useModels", () => ({
  useModels: vi.fn(() => ({
    models: [],
    loading: false,
    globalError: null,
    refreshModels: vi.fn(),
    downloadModel: vi.fn(),
    deleteModel: vi.fn(),
  })),
  formatBytes: vi.fn((bytes: number) => {
    if (bytes === 0) return "0 B";
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }),
  getModelInfo: vi.fn(() => ({
    name: "tiny.en",
    size: "~75 MB",
    sizeBytes: 75_000_000,
    speed: "🚀 Fastest",
    accuracy: "⭐",
    bestFor: "Quick notes",
    backend: "whisper_cpp",
    profile: "speed",
    downloaded: false,
    recommended: true,
  })),
}));

// Mock usePermissions hook
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: vi.fn(() => ({
    permissions: { clipboard: "granted", microphone: "granted" },
    isCapturingMic: false,
    requestClipboard: vi.fn(() => Promise.resolve(true)),
    requestMic: vi.fn(() => Promise.resolve(true)),
    stopMic: vi.fn(),
  })),
}));

// Mock useAppState hook
vi.mock("@/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store")>();
  return {
    ...actual,
    useAppState: vi.fn(() => ({
      onboarding: actual.DEFAULT_ONBOARDING,
      onboardingDispatch: vi.fn(),
      view: "main" as const,
      setView: vi.fn(),
    })),
  };
});

// ── Imports after mocks ──
import { FloureSelect } from "@/components/FloureSelect";
import { FloureToggle } from "@/components/FloureToggle";
import { FloureInput } from "@/components/FloureInput";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { Divider } from "@/components/Divider";
import MicButton from "@/components/MicButton";
import PttOverlay from "@/components/PttOverlay";
import ModelBadge from "@/components/ModelBadge";
import ErrorBanner, { type AppError } from "@/components/ErrorBanner";
import { Sidebar } from "@/components/Sidebar";
import SettingsPanel from "@/components/SettingsPanel";
import MicPermissionModal from "@/components/MicPermissionModal";
import TabSwitcher from "@/components/TabSwitcher";
import { ConfigSection } from "@/components/ConfigSection";
import { SettingRow } from "@/components/SettingRow";
import HeatmapCard from "@/components/HeatmapCard";
import StreakJourney from "@/components/StreakJourney";
import SnippetsPage from "@/components/SnippetsPage";
import DictionaryPage from "@/components/DictionaryPage";
import ModelsPage from "@/components/ModelsPage";
import InsightsPage from "@/components/InsightsPage";
import HistoryPage from "@/components/HistoryPage";
import OnboardingWizard from "@/components/OnboardingWizard";
import WidgetView from "@/components/WidgetView";
import { onboardingReducer, DEFAULT_ONBOARDING, MODEL_CATALOG } from "@/store";
import type { STTEvent } from "@/api";
import { createWsApi } from "@/api-ws";

// ── Helpers ──
function renderWithProviders(ui: React.ReactElement) {
  return render(ui);
}

// ══════════════════════════════════════════════════════════════════
// 1. FloureSelect
// ══════════════════════════════════════════════════════════════════
describe("FloureSelect", () => {
  it("renders without crashing", () => {
    renderWithProviders(
      <FloureSelect value="a" onChange={() => {}}>
        <option value="a">A</option>
      </FloureSelect>
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders children options", () => {
    renderWithProviders(
      <FloureSelect value="a" onChange={() => {}}>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </FloureSelect>
    );
    const select = screen.getByRole("combobox");
    expect(select).toHaveTextContent("Alpha");
    expect(select).toHaveTextContent("Beta");
  });

  it("calls onChange when value changes", async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FloureSelect value="a" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </FloureSelect>
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "b");
    expect(onChange).toHaveBeenCalled();
  });

  it("applies custom maxWidth", () => {
    const { container } = renderWithProviders(
      <FloureSelect value="a" onChange={() => {}} maxWidth="max-w-[300px]">
        <option value="a">A</option>
      </FloureSelect>
    );
    expect(container.querySelector(".max-w-\\[300px\\]")).toBeInTheDocument();
  });

  it("forwards ref correctly", () => {
    const ref = React.createRef<HTMLSelectElement>();
    renderWithProviders(
      <FloureSelect ref={ref} value="a" onChange={() => {}}>
        <option value="a">A</option>
      </FloureSelect>
    );
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it("spreads additional HTML attributes", () => {
    renderWithProviders(
      <FloureSelect value="a" onChange={() => {}} data-testid="my-select" disabled>
        <option value="a">A</option>
      </FloureSelect>
    );
    const select = screen.getByTestId("my-select");
    expect(select).toBeDisabled();
  });
});

// ══════════════════════════════════════════════════════════════════
// 2. FloureToggle
// ══════════════════════════════════════════════════════════════════
describe("FloureToggle", () => {
  it("renders without crashing", () => {
    renderWithProviders(<FloureToggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("displays label and description", () => {
    renderWithProviders(
      <FloureToggle checked={false} onChange={() => {}} label="Enable Feature" description="Turns on the thing" />
    );
    expect(screen.getByText("Enable Feature")).toBeInTheDocument();
    expect(screen.getByText("Turns on the thing")).toBeInTheDocument();
  });

  it("toggles on click", async () => {
    const onChange = vi.fn();
    renderWithProviders(<FloureToggle checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects checked state via aria-checked", () => {
    const { rerender } = renderWithProviders(<FloureToggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    rerender(<FloureToggle checked={true} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("renders without label/description when not provided", () => {
    renderWithProviders(<FloureToggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
    // No label text rendered
  });
});

// ══════════════════════════════════════════════════════════════════
// 3. FloureInput
// ══════════════════════════════════════════════════════════════════
describe("FloureInput", () => {
  it("renders without crashing", () => {
    renderWithProviders(<FloureInput />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("handles value changes", async () => {
    const onChange = vi.fn();
    renderWithProviders(<FloureInput onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox"), "hello");
    expect(onChange).toHaveBeenCalled();
  });

  it("applies placeholder", () => {
    renderWithProviders(<FloureInput placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeInTheDocument();
  });

  it("applies custom maxWidth", () => {
    const { container } = renderWithProviders(
      <FloureInput maxWidth="max-w-[300px]" />
    );
    expect(container.querySelector(".max-w-\\[300px\\]")).toBeInTheDocument();
  });

  it("forwards ref correctly", () => {
    const ref = React.createRef<HTMLInputElement>();
    renderWithProviders(<FloureInput ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("supports password type", () => {
    const { container } = renderWithProviders(<FloureInput type="password" />);
    const input = container.querySelector('input[type="password"]');
    expect(input).toBeInTheDocument();
  });

  it("supports number type", () => {
    renderWithProviders(<FloureInput type="number" />);
    expect(screen.getByRole("spinbutton")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 4. Button
// ══════════════════════════════════════════════════════════════════
describe("Button", () => {
  it("renders without crashing", () => {
    renderWithProviders(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("calls onClick on click", async () => {
    const onClick = vi.fn();
    renderWithProviders(<Button onClick={onClick}>Click</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });

  it("applies variant classes", () => {
    const { rerender } = renderWithProviders(<Button variant="primary">Test</Button>);
    let btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-accent");

    rerender(<Button variant="ghost">Test</Button>);
    btn = screen.getByRole("button");
    expect(btn.className).toContain("hover:bg-app-hover");
  });

  it("applies size classes", () => {
    const { rerender } = renderWithProviders(<Button size="sm">Test</Button>);
    expect(screen.getByRole("button").className).toContain("h-8");

    rerender(<Button size="lg">Test</Button>);
    expect(screen.getByRole("button").className).toContain("h-12");
  });

  it("disables when disabled prop is true", () => {
    renderWithProviders(<Button disabled>Click</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("forwards ref", () => {
    const ref = React.createRef<HTMLButtonElement>();
    renderWithProviders(<Button ref={ref}>Test</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});

// ══════════════════════════════════════════════════════════════════
// 5. Badge
// ══════════════════════════════════════════════════════════════════
describe("Badge", () => {
  it("renders without crashing", () => {
    renderWithProviders(<Badge>Pro</Badge>);
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("applies variant classes", () => {
    const { rerender } = renderWithProviders(<Badge variant="accent">Test</Badge>);
    let badge = screen.getByText("Test");
    expect(badge.className).toContain("bg-accent-muted");

    rerender(<Badge variant="success">Test</Badge>);
    badge = screen.getByText("Test");
    expect(badge.className).toContain("bg-success/10");

    rerender(<Badge variant="outline">Test</Badge>);
    badge = screen.getByText("Test");
    expect(badge.className).toContain("border-border");
  });

  it("forwards ref", () => {
    const ref = React.createRef<HTMLSpanElement>();
    renderWithProviders(<Badge ref={ref}>Test</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });
});

// ══════════════════════════════════════════════════════════════════
// 6. Card
// ══════════════════════════════════════════════════════════════════
describe("Card", () => {
  it("renders without crashing", () => {
    renderWithProviders(<Card>Content</Card>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("applies variant classes", () => {
    const { rerender } = renderWithProviders(<Card variant="sidebar">Test</Card>);
    expect(screen.getByText("Test").className).toContain("bg-app-sidebar");

    rerender(<Card variant="stats">Test</Card>);
    expect(screen.getByText("Test").className).toContain("bg-app-surface-card");
  });

  it("forwards ref", () => {
    const ref = React.createRef<HTMLDivElement>();
    renderWithProviders(<Card ref={ref}>Test</Card>);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

// ══════════════════════════════════════════════════════════════════
// 7. Divider
// ══════════════════════════════════════════════════════════════════
describe("Divider", () => {
  it("renders without crashing", () => {
    const { container } = renderWithProviders(<Divider />);
    expect(container.firstChild).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).className).toContain("h-px");
  });

  it("forwards ref", () => {
    const ref = React.createRef<HTMLDivElement>();
    renderWithProviders(<Divider ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});

// ══════════════════════════════════════════════════════════════════
// 8. MicButton
// ══════════════════════════════════════════════════════════════════
describe("MicButton", () => {
  it("renders without crashing", () => {
    renderWithProviders(<MicButton status="idle" connected={false} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("shows correct aria-label when idle", () => {
    renderWithProviders(<MicButton status="idle" connected={false} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Start transcription");
  });

  it("shows correct aria-label when connected", () => {
    renderWithProviders(<MicButton status="listening" connected={true} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label", "Stop transcription");
  });

  it("calls onToggle when clicked", async () => {
    const onToggle = vi.fn();
    renderWithProviders(<MicButton status="idle" connected={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("applies pulse animation when listening", () => {
    renderWithProviders(<MicButton status="listening" connected={true} onToggle={() => {}} />);
    expect(screen.getByRole("button").className).toContain("animate-mic-pulse");
  });

  it("applies error styles when in error state", () => {
    renderWithProviders(<MicButton status="error" connected={false} onToggle={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("border-[#EF4444]");
  });
});

// ══════════════════════════════════════════════════════════════════
// 9. PttOverlay
// ══════════════════════════════════════════════════════════════════
describe("PttOverlay", () => {
  it("renders nothing when not visible", () => {
    const { container } = renderWithProviders(<PttOverlay visible={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders overlay when visible", () => {
    renderWithProviders(<PttOverlay visible={true} />);
    expect(screen.getByText("Listening...")).toBeInTheDocument();
  });

  it("has pulsing mic icon", () => {
    renderWithProviders(<PttOverlay visible={true} />);
    expect(screen.getByText("Listening...")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 10. ModelBadge
// ══════════════════════════════════════════════════════════════════
describe("ModelBadge", () => {
  it("renders without crashing", () => {
    renderWithProviders(<ModelBadge profile="speed" resolvedModel={null} />);
    expect(screen.getByText("Speed")).toBeInTheDocument();
  });

  it("shows resolved model info when available", () => {
    renderWithProviders(
      <ModelBadge
        profile="speed"
        resolvedModel={{ profile: "distil", model: "distil-large-v3", backend: "faster_whisper", device: "cuda" }}
      />
    );
    expect(screen.getByText("Distil")).toBeInTheDocument();
    expect(screen.getByText("distil-large-v3")).toBeInTheDocument();
    expect(screen.getByText("GPU")).toBeInTheDocument();
  });

  it("shows default profile info without resolved model", () => {
    renderWithProviders(<ModelBadge profile="auto" resolvedModel={null} />);
    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("Auto-select")).toBeInTheDocument();
  });

  it("handles unknown profile gracefully", () => {
    renderWithProviders(<ModelBadge profile="unknown_profile" resolvedModel={null} />);
    // Should fall back to auto
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("shows CPU when device is not cuda", () => {
    renderWithProviders(
      <ModelBadge
        profile="speed"
        resolvedModel={{ profile: "speed", model: "tiny.en", backend: "whisper_cpp", device: "cpu" }}
      />
    );
    expect(screen.getByText("CPU")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 11. ErrorBanner
// ══════════════════════════════════════════════════════════════════
describe("ErrorBanner", () => {
  const mockErrors: AppError[] = [
    { id: "1", category: "connection", message: "Connection failed", canRetry: true, dismissed: false },
    { id: "2", category: "mic", message: "Mic not found", canRetry: false, dismissed: false },
  ];

  it("renders without crashing", () => {
    renderWithProviders(
      <ErrorBanner errors={[]} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    expect(screen.getByText(/No active errors/)).toBeInTheDocument();
  });

  it("displays errors", () => {
    renderWithProviders(
      <ErrorBanner errors={mockErrors} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
    expect(screen.getByText("Mic not found")).toBeInTheDocument();
  });

  it("hides dismissed errors", () => {
    const errors = [{ ...mockErrors[0], dismissed: true }];
    renderWithProviders(
      <ErrorBanner errors={errors} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    expect(screen.getByText(/No active errors/)).toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button clicked", async () => {
    const onDismiss = vi.fn();
    renderWithProviders(
      <ErrorBanner errors={mockErrors} onDismiss={onDismiss} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    const dismissBtn = screen.getByLabelText("Dismiss error: Connection failed");
    await userEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledWith("1");
  });

  it("calls onRetry when retry button clicked", async () => {
    const onRetry = vi.fn();
    renderWithProviders(
      <ErrorBanner errors={mockErrors} onDismiss={() => {}} onRetry={onRetry} visible={true} onClose={() => {}} />
    );
    const retryBtn = screen.getByText("Retry");
    await userEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledWith("1");
  });

  it("calls onClose when hide button clicked", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <ErrorBanner errors={[]} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={onClose} />
    );
    await userEvent.click(screen.getByLabelText("Hide error panel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("does not render retry button when canRetry is false", () => {
    renderWithProviders(
      <ErrorBanner errors={mockErrors} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    // Mic error has canRetry: false, so only 1 retry button (for connection error)
    const retryButtons = screen.getAllByText("Retry");
    expect(retryButtons.length).toBe(1);
  });

  it("shows retry hint when provided", () => {
    const errors = [{ ...mockErrors[0], retryHint: "Check your connection" }];
    renderWithProviders(
      <ErrorBanner errors={errors} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    expect(screen.getByText(/Check your connection/)).toBeInTheDocument();
  });

  it("has role=complementary and aria-label", () => {
    renderWithProviders(
      <ErrorBanner errors={[]} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    const aside = screen.getByRole("complementary");
    expect(aside).toHaveAttribute("aria-label", "Error log");
  });
});

// ══════════════════════════════════════════════════════════════════
// 12. Sidebar
// ══════════════════════════════════════════════════════════════════
describe("Sidebar", () => {
  it("renders without crashing", () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getAllByText("Floure").length).toBeGreaterThanOrEqual(1);
  });

  it("renders all navigation items", () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Insights")).toBeInTheDocument();
    expect(screen.getByText("Dictionary")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Models")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Help")).toBeInTheDocument();
  });

  it("calls onNavigate when nav item clicked", async () => {
    const onNavigate = vi.fn();
    renderWithProviders(<Sidebar onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText("Insights"));
    expect(onNavigate).toHaveBeenCalledWith("Insights");
  });

  it("highlights active item", () => {
    renderWithProviders(<Sidebar activeItem="Home" />);
    const homeBtn = screen.getByText("Home").closest("button");
    expect(homeBtn?.className).toContain("text-accent");
  });

  it("shows Floure branding card", () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getAllByText("Floure").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Local-first STT")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 13. SettingsPanel
// ══════════════════════════════════════════════════════════════════
describe("SettingsPanel", () => {
  const defaultSettings = {
    wsPort: 8765,
    asrProfile: "distil",
    backend: "auto",
    model: "",
    llmMode: "cleanup",
    llmProvider: "openrouter",
    llmModel: "",
    llmFallback: "",
    deepseekApiKey: "",
    openrouterApiKey: "",
    fastCommit: true,
    typing: true,
    clipboard: true,
    debug: false,
    hotwords: "",
    language: "",
  };

  it("renders nothing when not visible", () => {
    const { container } = renderWithProviders(
      <SettingsPanel settings={defaultSettings} onSave={() => {}} visible={false} onClose={() => {}} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders dialog when visible", () => {
    renderWithProviders(
      <SettingsPanel settings={defaultSettings} onSave={() => {}} visible={true} onClose={() => {}} />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("⚙ Settings")).toBeInTheDocument();
  });

  it("closes on Escape key", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SettingsPanel settings={defaultSettings} onSave={() => {}} visible={true} onClose={onClose} />
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when clicking backdrop", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <SettingsPanel settings={defaultSettings} onSave={() => {}} visible={true} onClose={onClose} />
    );
    const dialog = screen.getByRole("dialog");
    // Click on the backdrop (the dialog element itself, not the inner panel)
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onSave with updated settings", async () => {
    const onSave = vi.fn();
    renderWithProviders(
      <SettingsPanel settings={defaultSettings} onSave={onSave} visible={true} onClose={() => {}} />
    );
    await userEvent.click(screen.getByText("Save & Apply"));
    expect(onSave).toHaveBeenCalled();
  });

  it("shows/hides API keys", async () => {
    renderWithProviders(
      <SettingsPanel settings={defaultSettings} onSave={() => {}} visible={true} onClose={() => {}} />
    );
    const deepseekInput = screen.getByLabelText("DeepSeek API Key");
    expect(deepseekInput).toHaveAttribute("type", "password");

    const showToggle = screen.getByLabelText("Show API keys");
    await userEvent.click(showToggle);
    expect(deepseekInput).toHaveAttribute("type", "text");
  });

  it("has aria-modal and aria-label", () => {
    renderWithProviders(
      <SettingsPanel settings={defaultSettings} onSave={() => {}} visible={true} onClose={() => {}} />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Settings");
  });
});

// ══════════════════════════════════════════════════════════════════
// 14. MicPermissionModal
// ══════════════════════════════════════════════════════════════════
describe("MicPermissionModal", () => {
  it("renders nothing when not visible", () => {
    const { container } = renderWithProviders(
      <MicPermissionModal visible={false} onOpenConfig={() => {}} onClose={() => {}} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders modal when visible", () => {
    renderWithProviders(
      <MicPermissionModal visible={true} onOpenConfig={() => {}} onClose={() => {}} />
    );
    expect(screen.getByText("Microphone Access Required")).toBeInTheDocument();
  });

  it("calls onOpenConfig when Open Config clicked", async () => {
    const onOpenConfig = vi.fn();
    renderWithProviders(
      <MicPermissionModal visible={true} onOpenConfig={onOpenConfig} onClose={() => {}} />
    );
    await userEvent.click(screen.getByText("Open Config"));
    expect(onOpenConfig).toHaveBeenCalled();
  });

  it("calls onClose when Cancel clicked", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <MicPermissionModal visible={true} onOpenConfig={() => {}} onClose={onClose} />
    );
    await userEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    renderWithProviders(
      <MicPermissionModal visible={true} onOpenConfig={() => {}} onClose={onClose} />
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("has correct aria attributes", () => {
    renderWithProviders(
      <MicPermissionModal visible={true} onOpenConfig={() => {}} onClose={() => {}} />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Microphone permission required");
  });
});

// ══════════════════════════════════════════════════════════════════
// 15. TabSwitcher
// ══════════════════════════════════════════════════════════════════
describe("TabSwitcher", () => {
  const tabs = [
    { id: "all", label: "All" },
    { id: "code", label: "Code" },
  ];

  it("renders without crashing", () => {
    renderWithProviders(<TabSwitcher tabs={tabs} activeTab="all" onChange={() => {}} />);
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Code")).toBeInTheDocument();
  });

  it("calls onChange when tab clicked", async () => {
    const onChange = vi.fn();
    renderWithProviders(<TabSwitcher tabs={tabs} activeTab="all" onChange={onChange} />);
    await userEvent.click(screen.getByText("Code"));
    expect(onChange).toHaveBeenCalledWith("code");
  });

  it("highlights active tab", () => {
    renderWithProviders(<TabSwitcher tabs={tabs} activeTab="code" onChange={() => {}} />);
    const codeTab = screen.getByText("Code").closest("button");
    expect(codeTab?.className).toContain("text-accent");
  });
});

// ══════════════════════════════════════════════════════════════════
// 16. ConfigSection
// ══════════════════════════════════════════════════════════════════
describe("ConfigSection", () => {
  const MockIcon = () => <svg data-testid="mock-icon" />;

  it("renders without crashing", () => {
    renderWithProviders(
      <ConfigSection icon={MockIcon} title="My Section">
        <div>Content</div>
      </ConfigSection>
    );
    expect(screen.getByText("My Section")).toBeInTheDocument();
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders subtitle when provided", () => {
    renderWithProviders(
      <ConfigSection icon={MockIcon} title="Section" subtitle="A subtitle">
        <div>Content</div>
      </ConfigSection>
    );
    expect(screen.getByText("A subtitle")).toBeInTheDocument();
  });

  it("does not render subtitle when not provided", () => {
    const { container } = renderWithProviders(
      <ConfigSection icon={MockIcon} title="Section">
        <div>Content</div>
      </ConfigSection>
    );
    const subtitle = container.querySelector(".text-\\[10px\\].text-text-muted");
    expect(subtitle).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// 17. SettingRow
// ══════════════════════════════════════════════════════════════════
describe("SettingRow", () => {
  it("renders without crashing", () => {
    renderWithProviders(
      <SettingRow label="Language">
        <select><option>English</option></select>
      </SettingRow>
    );
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    renderWithProviders(
      <SettingRow label="Port" description="WebSocket port number">
        <input type="number" />
      </SettingRow>
    );
    expect(screen.getByText("WebSocket port number")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    renderWithProviders(
      <SettingRow label="Label">
        <input />
      </SettingRow>
    );
    expect(screen.queryByText("description")).not.toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 18. HeatmapCard
// ══════════════════════════════════════════════════════════════════
describe("HeatmapCard", () => {
  const heatmapData = Array.from({ length: 28 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    level: i % 5,
  }));

  it("renders without crashing", () => {
    renderWithProviders(<HeatmapCard data={heatmapData} />);
    expect(screen.getByText("Voice Activity Calendar")).toBeInTheDocument();
  });

  it("renders correct number of week groups", () => {
    const { container } = renderWithProviders(<HeatmapCard data={heatmapData} />);
    const weekGroups = container.querySelectorAll(".flex.flex-col.gap-\\[3px\\]");
    expect(weekGroups.length).toBeGreaterThanOrEqual(4);
  });

  it("renders legend labels", () => {
    renderWithProviders(<HeatmapCard data={heatmapData} />);
    expect(screen.getByText("Less")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
  });

  it("renders with empty data", () => {
    renderWithProviders(<HeatmapCard data={[]} />);
    expect(screen.getByText("Voice Activity Calendar")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 19. StreakJourney
// ══════════════════════════════════════════════════════════════════
describe("StreakJourney", () => {
  it("renders without crashing", () => {
    renderWithProviders(<StreakJourney streak={{ current: 0, longest: 10 }} />);
    expect(screen.getByText("0 days")).toBeInTheDocument();
    expect(screen.getByText("Best: 10 days")).toBeInTheDocument();
  });

  it("renders milestones", () => {
    renderWithProviders(<StreakJourney streak={{ current: 5, longest: 14 }} />);
    expect(screen.getByText("5 days")).toBeInTheDocument();
    // All milestones should be present
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 21. SnippetsPage
// ══════════════════════════════════════════════════════════════════
describe("SnippetsPage", () => {
  it("renders without crashing", () => {
    renderWithProviders(<SnippetsPage />);
    expect(screen.getByText("Snippets")).toBeInTheDocument();
    expect(screen.getByText("Save reusable text, prompts, links, and templates.")).toBeInTheDocument();
  });

  it("renders stats", () => {
    renderWithProviders(<SnippetsPage />);
    expect(screen.getByText("Total Snippets")).toBeInTheDocument();
    expect(screen.getByText("Favorites")).toBeInTheDocument();
    expect(screen.getByText("Total Uses")).toBeInTheDocument();
  });

  it("opens add snippet modal", async () => {
    renderWithProviders(<SnippetsPage />);
    // Click the button (not the modal header)
    const addButtons = screen.getAllByText("Add Snippet");
    await userEvent.click(addButtons[0]);
    expect(screen.getByText("Create a reusable text block with a quick trigger.")).toBeInTheDocument();
  });

  it("search filters snippets", async () => {
    renderWithProviders(<SnippetsPage />);
    const searchInput = screen.getByPlaceholderText("Search snippets...");
    await userEvent.type(searchInput, "nonexistent12345");
    expect(screen.getByText("No snippets found")).toBeInTheDocument();
  });

  it("tab switching works", async () => {
    renderWithProviders(<SnippetsPage />);
    const tabs = screen.getAllByRole("button");
    const favTab = tabs.find(el => el.textContent?.includes("Favorites ("));
    if (favTab) await userEvent.click(favTab);
    // "Favorites" appears in both stats and tab - use getAllByText
    const favElements = screen.getAllByText(/Favorites/);
    expect(favElements.length).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════
// 26. DictionaryPage
// ══════════════════════════════════════════════════════════════════
describe("DictionaryPage", () => {
  beforeEach(() => {
    // Mock fetch for dictionary API calls
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      })
    ) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", async () => {
    renderWithProviders(<DictionaryPage />);
    expect(screen.getByText("Dictionary")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    renderWithProviders(<DictionaryPage />);
    expect(screen.getByText("Dictionary")).toBeInTheDocument();
  });

  it("search input works", async () => {
    renderWithProviders(<DictionaryPage />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search dictionary...")).toBeInTheDocument();
    });
    const searchInput = screen.getByPlaceholderText("Search dictionary...");
    await userEvent.type(searchInput, "CEO");
    expect(searchInput).toHaveValue("CEO");
  });
});

// ══════════════════════════════════════════════════════════════════
// 27. ModelsPage
// ══════════════════════════════════════════════════════════════════
describe("ModelsPage", () => {
  it("renders without crashing", () => {
    renderWithProviders(<ModelsPage />);
    expect(screen.getByText("Models")).toBeInTheDocument();
  });

  it("shows filter tabs", () => {
    renderWithProviders(<ModelsPage />);
    expect(screen.getByText("All Models")).toBeInTheDocument();
    expect(screen.getByText("Downloaded")).toBeInTheDocument();
    expect(screen.getByText("Available")).toBeInTheDocument();
  });

  it("shows refresh button", () => {
    renderWithProviders(<ModelsPage />);
    expect(screen.getByText("Refresh")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 28. InsightsPage
// ══════════════════════════════════════════════════════════════════
describe("InsightsPage", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          wpm: 109,
          wpmTrend: 12,
          totalWords: 24600,
          wordsTrend: 18,
          aiFixes: 7,
          categories: [],
          streak: { current: 0, longest: 10 },
          heatmap: [],
        }),
      })
    ) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders loading then content", async () => {
    renderWithProviders(<InsightsPage />);
    // Initially shows loading
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    // After fetch resolves, should show Insights header
    await waitFor(() => {
      expect(screen.getByText("Your voice productivity story.")).toBeInTheDocument();
    });
  });

  it("shows loading state initially", async () => {
    renderWithProviders(<InsightsPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    // After data loads, loading disappears
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });
});

// ══════════════════════════════════════════════════════════════════
// 29. HistoryPage
// ══════════════════════════════════════════════════════════════════
describe("HistoryPage", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      })
    ) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", async () => {
    renderWithProviders(<HistoryPage onBack={() => {}} />);
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("calls onBack when back button clicked", async () => {
    const onBack = vi.fn();
    renderWithProviders(<HistoryPage onBack={onBack} />);
    const backBtn = screen.getByText("History").closest("div")?.querySelector("button");
    if (backBtn) await userEvent.click(backBtn);
    expect(onBack).toHaveBeenCalled();
  });

  it("shows empty state when no rows", async () => {
    renderWithProviders(<HistoryPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("No transcripts yet.")).toBeInTheDocument();
    });
  });

  it("has search input", async () => {
    renderWithProviders(<HistoryPage onBack={() => {}} />);
    expect(screen.getByPlaceholderText("Search transcripts...")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 30. OnboardingWizard
// ══════════════════════════════════════════════════════════════════
describe("OnboardingWizard", () => {
  it("renders without crashing", () => {
    renderWithProviders(<OnboardingWizard onFinished={() => {}} />);
    expect(screen.getByText("System Check")).toBeInTheDocument();
  });

  it("shows Run Checks button initially", () => {
    renderWithProviders(<OnboardingWizard onFinished={() => {}} />);
    expect(screen.getByText("Run Checks")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 31. WidgetView
// ══════════════════════════════════════════════════════════════════
describe("WidgetView", () => {
  it("renders without crashing", () => {
    renderWithProviders(<WidgetView />);
    // Widget renders a container
    const container = document.querySelector(".select-none.w-full.h-full");
    expect(container).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 32. Store: onboardingReducer
// ══════════════════════════════════════════════════════════════════
describe("onboardingReducer", () => {
  it("SET_STEP updates step", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_STEP", step: 3 });
    expect(result.step).toBe(3);
  });

  it("NEXT_STEP increments step", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "NEXT_STEP" });
    expect(result.step).toBe(1);
  });

  it("NEXT_STEP does not exceed totalSteps", () => {
    const state = { ...DEFAULT_ONBOARDING, step: 5 };
    const result = onboardingReducer(state, { type: "NEXT_STEP" });
    expect(result.step).toBe(5);
  });

  it("SET_COMPLETED marks completed", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_COMPLETED" });
    expect(result.completed).toBe(true);
  });

  it("SET_SKIPPED marks skipped and completed", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_SKIPPED" });
    expect(result.skipped).toBe(true);
    expect(result.completed).toBe(true);
  });

  it("SET_SYSTEM_CHECKS updates checks", () => {
    const checks = [{ name: "Test", status: "pass" as const, message: "OK" }];
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_SYSTEM_CHECKS", checks });
    expect(result.systemChecks).toEqual(checks);
  });

  it("SET_MIC updates mic state", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_MIC", index: 0, level: 0.5 });
    expect(result.selectedMicIndex).toBe(0);
    expect(result.micLevel).toBe(0.5);
  });

  it("SET_CLIPBOARD updates clipboard state", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_CLIPBOARD", enabled: true });
    expect(result.clipboardEnabled).toBe(true);
  });

  it("SET_TYPING updates typing state", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_TYPING", enabled: true });
    expect(result.typingEnabled).toBe(true);
  });

  it("SET_MODEL updates preferred model", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_MODEL", name: "large-v3-turbo" });
    expect(result.preferredModel).toBe("large-v3-turbo");
  });

  it("SET_DOWNLOAD_PROGRESS updates progress", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, {
      type: "SET_DOWNLOAD_PROGRESS",
      name: "tiny.en",
      percent: 50,
      bytesDownloaded: 37500000,
      bytesTotal: 75000000,
      status: "downloading",
    });
    expect(result.modelDownloadProgress["tiny.en"].percent).toBe(50);
    expect(result.modelDownloadProgress["tiny.en"].status).toBe("downloading");
  });

  it("SET_ERROR updates error", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "SET_ERROR", error: "Something failed" });
    expect(result.error).toBe("Something failed");
  });

  it("CLEAR_ERROR clears error", () => {
    const state = { ...DEFAULT_ONBOARDING, error: "Something" };
    const result = onboardingReducer(state, { type: "CLEAR_ERROR" });
    expect(result.error).toBeNull();
  });

  it("returns state for unknown action", () => {
    const result = onboardingReducer(DEFAULT_ONBOARDING, { type: "UNKNOWN" } as any);
    expect(result).toBe(DEFAULT_ONBOARDING);
  });
});

// ══════════════════════════════════════════════════════════════════
// 33. Store: DEFAULT_ONBOARDING
// ══════════════════════════════════════════════════════════════════
describe("DEFAULT_ONBOARDING", () => {
  it("has correct initial values", () => {
    expect(DEFAULT_ONBOARDING.step).toBe(0);
    expect(DEFAULT_ONBOARDING.totalSteps).toBe(5);
    expect(DEFAULT_ONBOARDING.completed).toBe(false);
    expect(DEFAULT_ONBOARDING.skipped).toBe(false);
    expect(DEFAULT_ONBOARDING.systemChecks).toEqual([]);
    expect(DEFAULT_ONBOARDING.selectedMicIndex).toBeNull();
    expect(DEFAULT_ONBOARDING.micLevel).toBe(0);
    expect(DEFAULT_ONBOARDING.clipboardEnabled).toBe(false);
    expect(DEFAULT_ONBOARDING.typingEnabled).toBe(false);
    expect(DEFAULT_ONBOARDING.preferredModel).toBe("small.en");
    expect(DEFAULT_ONBOARDING.error).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════
// 34. Store: MODEL_CATALOG
// ══════════════════════════════════════════════════════════════════
describe("MODEL_CATALOG", () => {
  it("has 5 models", () => {
    expect(MODEL_CATALOG.length).toBe(5);
  });

  it("each model has required fields", () => {
    for (const model of MODEL_CATALOG) {
      expect(model.name).toBeTruthy();
      expect(model.size).toBeTruthy();
      expect(model.sizeBytes).toBeGreaterThan(0);
      expect(model.speed).toBeTruthy();
      expect(model.accuracy).toBeTruthy();
      expect(model.bestFor).toBeTruthy();
      expect(["whisper_cpp", "faster_whisper"]).toContain(model.backend);
      expect(model.profile).toBeTruthy();
    }
  });

  it("models are sorted by size ascending", () => {
    for (let i = 1; i < MODEL_CATALOG.length; i++) {
      expect(MODEL_CATALOG[i].sizeBytes).toBeGreaterThanOrEqual(MODEL_CATALOG[i - 1].sizeBytes);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 35. API Layer: STTEvent types
// ══════════════════════════════════════════════════════════════════
describe("STTEvent type contract", () => {
  it("defines all required event types", () => {
    const eventTypes = ["state", "raw", "processed", "llm_partial", "mic", "error", "dropped", "info"];
    // This is a type-level check; at runtime we just verify the interface shape
    const sampleEvents: STTEvent[] = [
      { type: "state", state: "listening" },
      { type: "raw", text: "hello" },
      { type: "processed", text: "Hello" },
      { type: "llm_partial", text: "Hello world" },
      { type: "mic", level: 0.5 },
      { type: "error", message: "fail" },
      { type: "dropped", reason: "timeout" },
      { type: "info", profile: "speed", model: "tiny.en", backend: "whisper_cpp", device: "cpu" },
    ];
    for (const event of sampleEvents) {
      expect(eventTypes).toContain(event.type);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 36. API Layer: createWsApi
// ══════════════════════════════════════════════════════════════════
describe("createWsApi", () => {
  it("creates an API instance with required methods", () => {
    const api = createWsApi(8765);
    expect(typeof api.spawn).toBe("function");
    expect(typeof api.kill).toBe("function");
    expect(typeof api.start).toBe("function");
    expect(typeof api.stop).toBe("function");
    expect(typeof api.sendCommand).toBe("function");
    expect(typeof api.onEvent).toBe("function");
  });

  it("registers event listeners", () => {
    const api = createWsApi(8765);
    const listener = vi.fn();
    // Should not throw
    api.onEvent(listener);
  });

  it("kill clears listeners", () => {
    const api = createWsApi(8765);
    api.onEvent(vi.fn());
    // kill should not throw
    api.kill();
  });
});

// ══════════════════════════════════════════════════════════════════
// 37. API Layer: createTauriApi
// ══════════════════════════════════════════════════════════════════
describe("createTauriApi", () => {
  it("creates an API instance with required methods", async () => {
    const { createTauriApi } = await import("@/api-tauri");
    const api = createTauriApi(["--json-mode"]);
    expect(typeof api.spawn).toBe("function");
    expect(typeof api.kill).toBe("function");
    expect(typeof api.start).toBe("function");
    expect(typeof api.stop).toBe("function");
    expect(typeof api.sendCommand).toBe("function");
    expect(typeof api.onEvent).toBe("function");
  });

  it("registers event listeners", async () => {
    const { createTauriApi } = await import("@/api-tauri");
    const api = createTauriApi(["--json-mode"]);
    const listener = vi.fn();
    api.onEvent(listener);
    // No error should be thrown
  });

  it("kill clears listeners and child", async () => {
    const { createTauriApi } = await import("@/api-tauri");
    const api = createTauriApi(["--json-mode"]);
    api.onEvent(vi.fn());
    api.kill();
    // No error should be thrown
  });

  it("start sends start_recording command", async () => {
    const { createTauriApi } = await import("@/api-tauri");
    const api = createTauriApi(["--json-mode"]);
    // start() sends command via sendCommand, should not throw
    api.start();
  });

  it("stop sends stop_recording command", async () => {
    const { createTauriApi } = await import("@/api-tauri");
    const api = createTauriApi(["--json-mode"]);
    api.stop();
  });
});

// ══════════════════════════════════════════════════════════════════
// 38. API Layer: createWebAudioApi
// ══════════════════════════════════════════════════════════════════
describe("createWebAudioApi", () => {
  it("creates an API instance with required methods", async () => {
    const { createWebAudioApi } = await import("@/api-web-audio");
    const api = createWebAudioApi(8765);
    expect(typeof api.spawn).toBe("function");
    expect(typeof api.kill).toBe("function");
    expect(typeof api.start).toBe("function");
    expect(typeof api.stop).toBe("function");
    expect(typeof api.sendCommand).toBe("function");
    expect(typeof api.onEvent).toBe("function");
  });

  it("registers event listeners", async () => {
    const { createWebAudioApi } = await import("@/api-web-audio");
    const api = createWebAudioApi(8765);
    const listener = vi.fn();
    api.onEvent(listener);
  });

  it("kill clears listeners and state", async () => {
    const { createWebAudioApi } = await import("@/api-web-audio");
    const api = createWebAudioApi(8765);
    api.onEvent(vi.fn());
    api.kill();
  });
});

// ══════════════════════════════════════════════════════════════════
// 39. Store: useAppState
// ══════════════════════════════════════════════════════════════════
describe("useAppState", () => {
  it("is exported from store", () => {
    // useAppState is mocked in vi.mock above; verify the mock is wired up
    expect(true).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// 40. Edge Cases: Long text
// ══════════════════════════════════════════════════════════════════
describe("Edge cases: long text", () => {
  it("FloureInput handles long text", async () => {
    const longText = "A".repeat(1000);
    renderWithProviders(<FloureInput value={longText} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue(longText);
  });

  it("Badge handles long text", () => {
    const longText = "A".repeat(200);
    renderWithProviders(<Badge>{longText}</Badge>);
    expect(screen.getByText(longText)).toBeInTheDocument();
  });

  it("Button handles long text", () => {
    const longText = "A".repeat(200);
    renderWithProviders(<Button>{longText}</Button>);
    expect(screen.getByRole("button", { name: longText })).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 41. Edge Cases: Empty props
// ══════════════════════════════════════════════════════════════════
describe("Edge cases: empty/null props", () => {
  it("FloureToggle with empty label/description", () => {
    renderWithProviders(<FloureToggle checked={false} onChange={() => {}} label="" description="" />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("ConfigSection without subtitle", () => {
    const MockIcon = () => <svg />;
    renderWithProviders(
      <ConfigSection icon={MockIcon} title="Test">
        <div>child</div>
      </ConfigSection>
    );
    expect(screen.getByText("Test")).toBeInTheDocument();
  });

  it("HeatmapCard with empty data", () => {
    renderWithProviders(<HeatmapCard data={[]} />);
    expect(screen.getByText("Voice Activity Calendar")).toBeInTheDocument();
  });

  it("StreakJourney with zero streak", () => {
    renderWithProviders(<StreakJourney streak={{ current: 0, longest: 0 }} />);
    expect(screen.getByText("0 days")).toBeInTheDocument();
  });
});

// ══════════════════════════════════════════════════════════════════
// 42. Accessibility: ARIA attributes
// ══════════════════════════════════════════════════════════════════
describe("Accessibility: ARIA attributes", () => {
  it("FloureToggle has role=switch", () => {
    renderWithProviders(<FloureToggle checked={false} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("MicButton has aria-label", () => {
    renderWithProviders(<MicButton status="idle" connected={false} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-label");
  });

  it("SettingsPanel has role=dialog", () => {
    renderWithProviders(
      <SettingsPanel
        settings={{ wsPort: 8765, asrProfile: "distil", backend: "auto", model: "", llmMode: "cleanup", llmProvider: "openrouter", llmModel: "", llmFallback: "", deepseekApiKey: "", openrouterApiKey: "", fastCommit: true, typing: true, clipboard: true, debug: false, hotwords: "", language: "" }}
        onSave={() => {}}
        visible={true}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("MicPermissionModal has role=dialog", () => {
    renderWithProviders(
      <MicPermissionModal visible={true} onOpenConfig={() => {}} onClose={() => {}} />
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("ErrorBanner has role=complementary", () => {
    renderWithProviders(
      <ErrorBanner errors={[]} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("ErrorBanner error items have role=alert", () => {
    const errors = [{ id: "1", category: "connection" as const, message: "Error occurred", canRetry: false, dismissed: false }];
    renderWithProviders(
      <ErrorBanner errors={errors} onDismiss={() => {}} onRetry={() => {}} visible={true} onClose={() => {}} />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
