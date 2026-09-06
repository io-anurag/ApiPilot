import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiEnhancementStage } from "../../src/components/AiEnhancementStage";

describe("AiEnhancementStage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the trigger action when not skipped", () => {
    render(<AiEnhancementStage onAdvanced={() => {}} />);
    expect(screen.getByRole("button", { name: "Enhance with AI" })).toBeInTheDocument();
  });

  it("shows a plain-language skip explanation and a retry action (FR-023, FR-025)", async () => {
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
        failureExplanation={{
          category: "unavailable",
          summary: "Local AI is unavailable right now.",
          nextStep: "Your deterministic scenarios are unaffected and ready to review.",
          retryable: true,
        }}
        onAdvanced={onAdvanced}
      />,
    );

    expect(screen.getByTestId("ai-enhancement-skipped")).toBeInTheDocument();
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent(
      "Local AI is unavailable right now.",
    );
    expect(screen.getByTestId("ai-enhancement-next-step")).toHaveTextContent(
      "ready to review",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry AI enhancement" }));
    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
  });

  it("never renders internal diagnostics to the user (FR-024)", () => {
    render(
      <AiEnhancementStage
        status="skipped"
        failureExplanation={{
          category: "too-slow",
          summary: "The local AI model was too slow to finish this on this machine.",
          nextStep: "Try enhancing a smaller specification.",
          retryable: false,
        }}
        onAdvanced={() => {}}
      />,
    );

    // The message this feature replaced read: "AI enhancement was skipped (TIMEOUT): Inference
    // exceeded the configured timeout of 300000ms." — a category literal, an implementation
    // constant and a raw millisecond value, none of which a user can act on.
    const banner = screen.getByTestId("ai-enhancement-skipped");
    for (const leak of ["TIMEOUT", "300000", "ms", "AI_INFERENCE_TIMEOUT_MS", "AIProviderError"]) {
      expect(banner.textContent).not.toContain(leak);
    }
  });

  it("offers no retry when retrying cannot change the outcome (FR-025)", () => {
    render(
      <AiEnhancementStage
        status="skipped"
        failureExplanation={{
          category: "not-viable",
          summary: "This specification needs about 34 minutes, but the limit is about 5 minutes.",
          nextStep: "Enhance a smaller specification, or raise the time limit.",
          retryable: false,
        }}
        onAdvanced={() => {}}
      />,
    );

    // Previously an identical retry button appeared for every failure kind, inviting the user to
    // spend the whole budget again to reach exactly the same result.
    expect(
      screen.queryByRole("button", { name: "Retry AI enhancement" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-enhancement-next-step")).toHaveTextContent(
      "smaller specification",
    );
  });

  it("distinguishes a cancelled run from a failed one (FR-021)", () => {
    render(
      <AiEnhancementStage
        status="partial"
        cancelled
        failureExplanation={{
          category: "cancelled",
          summary: "AI enhancement was cancelled before it finished.",
          nextStep: "Any scenarios generated before you cancelled have been kept.",
          retryable: true,
        }}
        onAdvanced={() => {}}
      />,
    );

    expect(screen.getByTestId("ai-enhancement-partial")).toBeInTheDocument();
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent("cancelled");
    expect(screen.getByTestId("ai-enhancement-next-step")).toHaveTextContent("have been kept");
  });
});
