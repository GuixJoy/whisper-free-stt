import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PttOverlay from "@/components/PttOverlay";

describe("PttOverlay", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(<PttOverlay visible={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders listening text when visible", () => {
    render(<PttOverlay visible={true} />);
    expect(screen.getByText("Listening...")).toBeDefined();
  });

  it("renders mic icon when visible", () => {
    const { container } = render(<PttOverlay visible={true} />);
    expect(container.querySelector("svg")).toBeDefined();
  });

  it("renders waveform dots", () => {
    const { container } = render(<PttOverlay visible={true} />);
    const dots = container.querySelectorAll('[class*="rounded-full bg-accent"]');
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });
});
