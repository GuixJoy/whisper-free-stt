import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ModelBadge from "@/components/ModelBadge";

describe("ModelBadge", () => {
  it("renders auto profile by default", () => {
    render(<ModelBadge profile="auto" resolvedModel={null} />);
    expect(screen.getByText("Auto")).toBeDefined();
    expect(screen.getByText("Auto-select")).toBeDefined();
  });

  it("renders parakeet profile", () => {
    render(<ModelBadge profile="parakeet" resolvedModel={null} />);
    expect(screen.getByText("Parakeet")).toBeDefined();
    expect(screen.getByText("Parakeet TDT")).toBeDefined();
  });

  it("renders whisper-turbo profile", () => {
    render(<ModelBadge profile="whisper-turbo" resolvedModel={null} />);
    expect(screen.getByText("Turbo")).toBeDefined();
    expect(screen.getByText("large-v3-turbo")).toBeDefined();
  });

  it("shows resolved model info when available", () => {
    const resolved = {
      profile: "whisper-turbo",
      model: "large-v3-turbo",
      backend: "sherpa_onnx",
      device: "cuda",
    };
    render(<ModelBadge profile="auto" resolvedModel={resolved} />);
    expect(screen.getByText("Turbo")).toBeDefined();
    expect(screen.getByText("large-v3-turbo")).toBeDefined();
    expect(screen.getByText("GPU")).toBeDefined();
  });

  it("shows CPU when device is cpu", () => {
    const resolved = {
      profile: "whisper-base",
      model: "base",
      backend: "sherpa_onnx",
      device: "cpu",
    };
    render(<ModelBadge profile="auto" resolvedModel={resolved} />);
    expect(screen.getByText("CPU")).toBeDefined();
  });

  it("falls back to auto for unknown profile", () => {
    render(<ModelBadge profile="unknown" resolvedModel={null} />);
    expect(screen.getByText("Auto")).toBeDefined();
  });
});
