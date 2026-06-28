import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ModelBadge from "@/components/ModelBadge";

describe("ModelBadge", () => {
  it("renders auto profile by default", () => {
    render(<ModelBadge profile="auto" resolvedModel={null} />);
    expect(screen.getByText("Auto")).toBeDefined();
    expect(screen.getByText("Auto-select")).toBeDefined();
  });

  it("renders speed profile", () => {
    render(<ModelBadge profile="speed" resolvedModel={null} />);
    expect(screen.getByText("Speed")).toBeDefined();
    expect(screen.getByText("tiny.en")).toBeDefined();
  });

  it("renders turbo profile", () => {
    render(<ModelBadge profile="turbo" resolvedModel={null} />);
    expect(screen.getByText("Turbo")).toBeDefined();
    expect(screen.getByText("large-v3-turbo")).toBeDefined();
  });

  it("shows resolved model info when available", () => {
    const resolved = { profile: "distil", model: "distil-large-v3", backend: "faster_whisper", device: "cuda" };
    render(<ModelBadge profile="auto" resolvedModel={resolved} />);
    expect(screen.getByText("Distil")).toBeDefined();
    expect(screen.getByText("distil-large-v3")).toBeDefined();
    expect(screen.getByText("GPU")).toBeDefined();
  });

  it("shows CPU when device is cpu", () => {
    const resolved = { profile: "accuracy", model: "small.en", backend: "whisper_cpp", device: "cpu" };
    render(<ModelBadge profile="auto" resolvedModel={resolved} />);
    expect(screen.getByText("CPU")).toBeDefined();
  });

  it("falls back to auto for unknown profile", () => {
    render(<ModelBadge profile="unknown" resolvedModel={null} />);
    expect(screen.getByText("Auto")).toBeDefined();
  });
});
