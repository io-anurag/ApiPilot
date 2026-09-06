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

/** A fetch mock distinguishing the POST that triggers a run (left pending until resolved
 * manually) from GET polls, which return successive entries from `progressSequence` — mirrors
 * how the real backend's progress advances one poll at a time (specs/012-ai-enhancement-progress). */
function stubPollingFetch(progressSequence: unknown[]) {
  let pollCount = 0;
  let resolvePost!: (value: unknown) => void;
  const postPromise = new Promise((resolve) => {
    resolvePost = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return postPromise;
      const progress = progressSequence[Math.min(pollCount, progressSequence.length - 1)];
      pollCount += 1;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            workflow: { stages: { aiEnhancement: { status: "active", progress } } },
          }),
      });
    }),
  );
  return {
    resolveRun: () =>
      resolvePost({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ workflow: { activeStageId: "scenarioReview" } }),
      }),
  };
}

describe("AiEnhancementStage (progress polling, specs/012-ai-enhancement-progress)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("polls workflow status on a 2-second interval while running, rendering per-batch progress from each poll (FR-001, FR-002, FR-003)", async () => {
    vi.useFakeTimers();
    const progressSequence = [
      {
        totalBatches: 3,
        batches: [
          { index: 0, status: "in-progress" },
          { index: 1, status: "pending" },
          { index: 2, status: "pending" },
        ],
      },
      {
        totalBatches: 3,
        batches: [
          { index: 0, status: "succeeded" },
          { index: 1, status: "in-progress" },
          { index: 2, status: "pending" },
        ],
      },
    ];
    stubPollingFetch(progressSequence);

    render(<AiEnhancementStage onAdvanced={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));

    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.getByText("Processing batch 1 of 3…")).toBeInTheDocument();
    expect(screen.getByText("Batch 1: In progress")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.getByText("Processing batch 2 of 3…")).toBeInTheDocument();
    expect(screen.getByText("Batch 1: Succeeded")).toBeInTheDocument();
  });

  it("stops polling and hides progress once the run resolves", async () => {
    vi.useFakeTimers();
    const { resolveRun } = stubPollingFetch([
      { totalBatches: 2, batches: [{ index: 0, status: "in-progress" }, { index: 1, status: "pending" }] },
    ]);

    render(<AiEnhancementStage onAdvanced={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(screen.getByTestId("ai-enhancement-progress")).toBeInTheDocument();

    resolveRun();
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByTestId("ai-enhancement-progress")).not.toBeInTheDocument();
  });

  it("never shows a batch progress indicator for a single-batch run (FR-005)", async () => {
    vi.useFakeTimers();
    stubPollingFetch([{ totalBatches: 1, batches: [{ index: 0, status: "in-progress" }] }]);

    render(<AiEnhancementStage onAdvanced={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    await vi.advanceTimersByTimeAsync(2000);

    expect(screen.getByRole("button", { name: "Enhancing…" })).toBeInTheDocument();
    expect(screen.queryByTestId("ai-enhancement-progress")).not.toBeInTheDocument();
  });
});
