import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * Live progress for a ceiling-bounded run (specs/014-ai-batching-policy FR-012).
 *
 * The planned unit count alone overstates what a run will do — a 39-unit plan under a five-minute
 * ceiling completes roughly the first seven — so a run that has settled at its ceiling must not
 * present the remainder as a queue of failures.
 */
describe("AiEnhancementStage run ceiling progress", () => {
  /** Mirrors the component's own poll cadence; progress cannot appear before one tick elapses. */
  const PROGRESS_POLL_INTERVAL_MS = 2000;

  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * Stubs fetch so the run POST never resolves — keeping the component in its running state, which
   * is the only state that renders progress — while the status poll returns `progress`.
   */
  function stubPollingWith(progress: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: { method?: string } | null) => {
        if (init?.method === "POST") return new Promise(() => {});
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ workflow: { stages: { aiEnhancement: { progress } } } }),
        });
      }),
    );
  }

  function startRun() {
    render(<AiEnhancementStage onAdvanced={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    return act(() => vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL_MS + 100));
  }

  it("names not-attempted units as such rather than as failures, and shows the remaining allowance", async () => {
    stubPollingWith({
      totalBatches: 4,
      batches: [
        { index: 0, status: "succeeded" },
        { index: 1, status: "failed", errorCategory: "TIMEOUT" },
        { index: 2, status: "not-attempted" },
        { index: 3, status: "not-attempted" },
      ],
      startedAt: new Date().toISOString(),
      generatingSince: new Date().toISOString(),
      phase: "generating",
      cancelRequested: false,
      runBudgetRemainingMs: 90_000,
    });

    await startRun();

    const list = screen.getByLabelText("Batch progress");
    expect(list).toHaveTextContent("Batch 3: Not attempted");
    expect(list).toHaveTextContent("Batch 4: Not attempted");
    // A unit the ceiling never started is not a failure, and must not be coloured as one.
    expect(screen.getByText("Batch 3: Not attempted")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText("Batch 2: Failed")).toHaveAttribute("data-tone", "danger");
    expect(screen.getByTestId("ai-enhancement-run-budget-remaining")).toHaveTextContent(
      "1m 30s of run time left",
    );
  });

  it("says the limit is reached rather than showing no time left", async () => {
    stubPollingWith({
      totalBatches: 2,
      batches: [
        { index: 0, status: "succeeded" },
        { index: 1, status: "in-progress" },
      ],
      startedAt: new Date().toISOString(),
      generatingSince: new Date().toISOString(),
      phase: "generating",
      cancelRequested: false,
      runBudgetRemainingMs: 0,
    });

    await startRun();

    // A unit already in flight when the ceiling elapses runs to completion, so "0s left" would
    // read as a stalled run rather than a finishing one.
    expect(screen.getByTestId("ai-enhancement-run-budget-remaining")).toHaveTextContent(
      "run time limit reached; finishing the current batch",
    );
  });
});
