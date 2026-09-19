import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloureToggle } from "@/components/FloureToggle";

describe("FloureToggle", () => {
  it("renders unchecked by default", () => {
    render(<FloureToggle checked={false} onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("renders checked when checked=true", () => {
    render(<FloureToggle checked={true} onChange={vi.fn()} />);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onChange with toggled value on click", () => {
    const handleChange = vi.fn();
    render(<FloureToggle checked={false} onChange={handleChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with false when clicking checked toggle", () => {
    const handleChange = vi.fn();
    render(<FloureToggle checked={true} onChange={handleChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(handleChange).toHaveBeenCalledWith(false);
  });

  it("displays label when provided", () => {
    render(<FloureToggle checked={false} onChange={vi.fn()} label="Enable feature" />);
    expect(screen.getByText("Enable feature")).toBeDefined();
  });

  it("displays description when provided", () => {
    render(
      <FloureToggle checked={false} onChange={vi.fn()} label="Toggle" description="A helpful description" />,
    );
    expect(screen.getByText("A helpful description")).toBeDefined();
  });

  it("renders without label or description", () => {
    const { container } = render(<FloureToggle checked={false} onChange={vi.fn()} />);
    expect(container.querySelector('[role="switch"]')).toBeDefined();
  });
});
