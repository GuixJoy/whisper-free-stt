import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloureSelect } from "@/components/FloureSelect";

describe("FloureSelect", () => {
  it("renders with options", () => {
    render(
      <FloureSelect>
        <option value="a">Option A</option>
        <option value="b">Option B</option>
      </FloureSelect>,
    );
    const select = screen.getByRole("combobox");
    expect(select).toBeDefined();
    expect(screen.getByText("Option A")).toBeDefined();
    expect(screen.getByText("Option B")).toBeDefined();
  });

  it("calls onChange when selection changes", () => {
    const handleChange = vi.fn();
    render(
      <FloureSelect onChange={handleChange}>
        <option value="a">Option A</option>
        <option value="b">Option B</option>
      </FloureSelect>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "b" } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it("applies custom className", () => {
    render(
      <FloureSelect className="custom-class">
        <option value="a">Option A</option>
      </FloureSelect>,
    );
    const select = screen.getByRole("combobox");
    expect(select.className).toContain("custom-class");
  });

  it("forwards ref", () => {
    const ref = { current: null };
    render(
      <FloureSelect ref={ref}>
        <option value="a">Option A</option>
      </FloureSelect>,
    );
    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });
});
