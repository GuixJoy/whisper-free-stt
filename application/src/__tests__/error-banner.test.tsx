import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorSidePanel, { type AppError } from "@/components/ErrorBanner";

const mockErrors: AppError[] = [
  {
    id: "1",
    category: "mic",
    message: "Microphone not found",
    canRetry: true,
    retryHint: "Check your mic connection",
    dismissed: false,
  },
  {
    id: "2",
    category: "connection",
    message: "Lost connection to engine",
    canRetry: false,
    dismissed: false,
  },
];

describe("ErrorSidePanel", () => {
  it("renders error count in header", () => {
    render(
      <ErrorSidePanel
        errors={mockErrors}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Errors \(2\)/)).toBeDefined();
  });

  it("renders error messages", () => {
    render(
      <ErrorSidePanel
        errors={mockErrors}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Microphone not found")).toBeDefined();
    expect(screen.getByText("Lost connection to engine")).toBeDefined();
  });

  it("shows retry hint when present", () => {
    render(
      <ErrorSidePanel
        errors={mockErrors}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Check your mic connection/)).toBeDefined();
  });

  it("calls onDismiss when dismiss button clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ErrorSidePanel
        errors={mockErrors}
        onDismiss={onDismiss}
        onRetry={vi.fn()}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    const dismissButtons = screen.getAllByLabelText(/Dismiss error/);
    fireEvent.click(dismissButtons[0]);
    expect(onDismiss).toHaveBeenCalledWith("1");
  });

  it("shows retry button when canRetry is true", () => {
    render(
      <ErrorSidePanel
        errors={mockErrors}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    const retryButtons = screen.getAllByText("Retry");
    expect(retryButtons.length).toBe(1);
  });

  it("calls onRetry when retry button clicked", () => {
    const onRetry = vi.fn();
    render(
      <ErrorSidePanel
        errors={mockErrors}
        onDismiss={vi.fn()}
        onRetry={onRetry}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledWith("1");
  });

  it("hides dismissed errors", () => {
    const dismissedErrors = [{ ...mockErrors[0], dismissed: true }];
    render(
      <ErrorSidePanel
        errors={dismissedErrors}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("No active errors. System running normally.")).toBeDefined();
  });

  it("calls onClose when hide button clicked", () => {
    const onClose = vi.fn();
    render(
      <ErrorSidePanel
        errors={[]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={true}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText("Hide error panel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies visible styles when visible", () => {
    const { container } = render(
      <ErrorSidePanel
        errors={[]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={true}
        onClose={vi.fn()}
      />,
    );
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("opacity-100");
  });

  it("applies hidden styles when not visible", () => {
    const { container } = render(
      <ErrorSidePanel
        errors={[]}
        onDismiss={vi.fn()}
        onRetry={vi.fn()}
        visible={false}
        onClose={vi.fn()}
      />,
    );
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("opacity-0");
  });
});
