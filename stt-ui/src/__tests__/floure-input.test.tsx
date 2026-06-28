import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloureInput } from "@/components/FloureInput";

describe("FloureInput", () => {
  it("renders with placeholder", () => {
    render(<FloureInput placeholder="Enter text" />);
    expect(screen.getByPlaceholderText("Enter text")).toBeDefined();
  });

  it("calls onChange when typing", () => {
    const handleChange = vi.fn();
    render(<FloureInput onChange={handleChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hello" } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("applies custom className", () => {
    render(<FloureInput className="my-class" />);
    expect(screen.getByRole("textbox").className).toContain("my-class");
  });

  it("forwards ref", () => {
    const ref = { current: null };
    render(<FloureInput ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("passes through input attributes", () => {
    render(<FloureInput type="number" min={0} max={100} />);
    const input = screen.getByRole("spinbutton");
    expect(input.getAttribute("min")).toBe("0");
    expect(input.getAttribute("max")).toBe("100");
  });
});
