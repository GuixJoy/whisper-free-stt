import "@testing-library/jest-dom";

// Mock CSS.supports (not available in jsdom but used by WidgetView at module level)
if (typeof globalThis.CSS === "undefined") {
  (globalThis as any).CSS = { supports: () => false };
} else if (typeof (globalThis as any).CSS.supports !== "function") {
  (globalThis as any).CSS.supports = () => false;
}