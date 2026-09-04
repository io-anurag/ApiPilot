import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiEnhancementStage } from "../../src/components/AiEnhancementStage";

describe("AiEnhancementStage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the trigger action when not skipped", () => {
    render(<AiEnhancementStage onAdvanced={() => {}} />);
    expect(screen.getByRole("button", { name: "Enhance with AI" })).toBeInTheDocument();
  });

  it("shows a skip banner with the recorded error and a retry action (FR-008, FR-008a)", async () => {
    const onAdvanced = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ workflow: { activeStageId: "scenarioReview" } }),
      }),
    );

    render(
      <AiEnhancementStage
        status="skipped"
        aiErrorCategory="PROVIDER_UNAVAILABLE"
        aiErrorMessage="local model not ready"
        onAdvanced={onAdvanced}
      />,
    );

    expect(screen.getByTestId("ai-enhancement-skipped")).toBeInTheDocument();
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent(
      "PROVIDER_UNAVAILABLE",
    );
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent(
      "local model not ready",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry AI enhancement" }));
    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
  });

  it("shows a partial banner (distinct from skipped) with the recorded error and a retry action (FR-011)", async () => {
    const onAdvanced = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ workflow: { activeStageId: "scenarioReview" } }),
      }),
    );

    render(
      <AiEnhancementStage
        status="partial"
        aiErrorCategory="TIMEOUT"
        aiErrorMessage="provider timed out for 1 of 4 batches"
        onAdvanced={onAdvanced}
      />,
    );

    expect(screen.getByTestId("ai-enhancement-partial")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-enhancement-skipped")).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent("TIMEOUT");
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent(
      "provider timed out for 1 of 4 batches",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry AI enhancement" }));
    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
  });
});
