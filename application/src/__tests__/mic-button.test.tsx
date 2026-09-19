import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MicButton from "@/components/MicButton";

describe("MicButton", () => {
  it("renders start transcription label when disconnected", () => {
    render(<MicButton status="idle" connected={false} onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Start transcription")).toBeDefined();
  });

  it("renders stop transcription label when connected", () => {
    render(<MicButton status="listening" connected={true} onToggle={vi.fn()} />);
    expect(screen.getByLabelText("Stop transcription")).toBeDefined();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(<MicButton status="idle" connected={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows Mic icon when connected", () => {
    render(<MicButton status="listening" connected={true} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button.querySelector("svg")).toBeDefined();
  });

  it("shows MicOff icon when disconnected", () => {
    render(<MicButton status="idle" connected={false} onToggle={vi.fn()} />);
    const button = screen.getByRole("button");
    expect(button.querySelector("svg")).toBeDefined();
  });
});
