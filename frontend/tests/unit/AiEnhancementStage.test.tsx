import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiEnhancementStage } from "../../src/components/AiEnhancementStage";

describe("AiEnhancementStage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the trigger action when not skipped", () => {
    render(<AiEnhancementStage skipped={false} onAdvanced={() => {}} />);
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
        skipped
        aiErrorCategory="PROVIDER_UNAVAILABLE"
        aiErrorMessage="local model not ready"
        onAdvanced={onAdvanced}
      />,
    );

    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent("PROVIDER_UNAVAILABLE");
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent("local model not ready");

    fireEvent.click(screen.getByRole("button", { name: "Retry AI enhancement" }));
    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
  });
});
