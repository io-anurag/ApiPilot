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
    for (const leak of [
      "TIMEOUT",
      "300000",
      "ms",
      "AI_INFERENCE_TIMEOUT_MS",
      "AIProviderError",
    ]) {
      expect(banner.textContent).not.toContain(leak);
    }
  });

  it("offers no retry when retrying cannot change the outcome (FR-025)", () => {
    render(
      <AiEnhancementStage
        status="skipped"
        failureExplanation={{
          category: "not-viable",
          summary:
            "This specification needs about 34 minutes, but the limit is about 5 minutes.",
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

  it("offers a retry action only for eligible batches (specs/015-ai-batch-retry FR-002, FR-003, FR-011)", () => {
    render(
      <AiEnhancementStage
        status="partial"
        failureExplanation={{
          category: "unavailable",
          summary: "Local AI is unavailable right now.",
          nextStep: "Retry once it recovers.",
          retryable: true,
        }}
        batchOutcomes={[
          { index: 0, operationKeys: ["GET /pets"], status: "succeeded" },
          {
            index: 1,
            operationKeys: ["POST /pets"],
            status: "failed",
            errorCategory: "PROVIDER_UNAVAILABLE",
            failureExplanation: {
              category: "unavailable",
              summary: "Local AI is unavailable right now.",
              nextStep: "Retry once it recovers.",
              retryable: true,
            },
          },
          {
            index: 2,
            operationKeys: ["GET /pets/{petId}"],
            status: "failed",
            errorCategory: "TIMEOUT",
            failureExplanation: {
              category: "too-slow",
              summary: "The local AI model was too slow to finish this on this machine.",
              nextStep: "Try a smaller specification.",
              retryable: false,
            },
          },
        ]}
        onAdvanced={() => {}}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /retry batch 1/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry batch 2/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /retry batch 3/i }),
    ).not.toBeInTheDocument();
  });

  it("retries the requested batch and reflects the updated workflow (specs/015-ai-batch-retry)", async () => {
    const onAdvanced = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          workflow: { stages: { aiEnhancement: { status: "complete" } } },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AiEnhancementStage
        status="partial"
        failureExplanation={{
          category: "unavailable",
          summary: "Local AI is unavailable right now.",
          nextStep: "Retry once it recovers.",
          retryable: true,
        }}
        batchOutcomes={[
          {
            index: 3,
            operationKeys: ["DELETE /pets/{petId}"],
            status: "failed",
            errorCategory: "PROVIDER_UNAVAILABLE",
            failureExplanation: {
              category: "unavailable",
              summary: "Local AI is unavailable right now.",
              nextStep: "Retry once it recovers.",
              retryable: true,
            },
          },
        ]}
        onAdvanced={onAdvanced}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /retry batch 4/i }));

    await waitFor(() => expect(onAdvanced).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test-generation-workflow/ai-enhancement/retry-batch",
      expect.objectContaining({ body: JSON.stringify({ batchIndex: 3 }) }),
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
    expect(screen.getByTestId("ai-enhancement-skip-banner")).toHaveTextContent(
      "cancelled",
    );
    expect(screen.getByTestId("ai-enhancement-next-step")).toHaveTextContent(
      "have been kept",
    );
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
   * is the only state that renders progress — while the `progressOnly` status poll returns
   * `progress` and, optionally, a trimmed `liveScenarios` list (contracts/
   * ai-enhancement-progress-v2.md "progressOnly" addendum).
   */
  function stubPollingWith(progress: unknown, liveScenarios: unknown[] = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: { method?: string } | null) => {
        if (init?.method === "POST") return new Promise(() => {});
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              progress: {
                aiEnhancement: { progress },
                liveScenarios,
              },
            }),
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
    expect(list).toHaveTextContent("Batch 3: Not attempted (run limit)");
    expect(list).toHaveTextContent("Batch 4: Not attempted (run limit)");
    expect(screen.getByText("Batch 3: Not attempted (run limit)")).toHaveAttribute(
      "data-tone",
      "warning",
    );
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

  it("shows completed AI scenarios while the enhancement request is still running", async () => {
    stubPollingWith(
      {
        totalBatches: 2,
        batches: [
          { index: 0, status: "succeeded" },
          { index: 1, status: "in-progress" },
        ],
        startedAt: new Date().toISOString(),
        generatingSince: new Date().toISOString(),
        phase: "generating",
        cancelRequested: false,
      },
      [
        {
          scenarioId: "ai-scenario-1",
          operationMethod: "GET",
          operationPath: "/items",
          category: "positive",
        },
      ],
    );

    await startRun();

    expect(screen.getByTestId("ai-enhancement-live-results")).toHaveTextContent(
      "1 AI scenario ready",
    );
    expect(screen.getByLabelText("Live AI scenarios")).toHaveTextContent(
      "GET/itemspositive",
    );
  });
});

/**
 * A run started before a page reload keeps running server-side (FR-007), but this component's
 * local `running`/`progress` state previously reset to idle on remount — showing the trigger
 * button as if nothing were happening, so clicking it only produced "already in progress" from
 * the server's concurrency guard. `activeProgress` seeds state from the workflow snapshot the
 * page already fetched on mount, restoring the live view the reload interrupted.
 */
describe("AiEnhancementStage resuming an in-progress run after reload", () => {
  const PROGRESS_POLL_INTERVAL_MS = 2000;

  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resumes a running retry when workflow refresh supplies progress after mount", async () => {
    const activeProgress = {
      totalBatches: 2,
      batches: [
        { index: 0, status: "succeeded" as const },
        { index: 1, status: "in-progress" as const },
      ],
      startedAt: "2026-01-01T00:00:00.000Z",
      phase: "generating" as const,
      cancelRequested: false,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          progress: {
            aiEnhancement: { status: "active", progress: activeProgress },
            liveScenarios: [],
          },
        }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAdvanced = vi.fn();
    const view = render(<AiEnhancementStage onAdvanced={onAdvanced} />);

    view.rerender(
      <AiEnhancementStage activeProgress={activeProgress} onAdvanced={onAdvanced} />,
    );

    expect(screen.getByRole("button", { name: "Enhancing…" })).toBeDisabled();
    expect(screen.getByTestId("ai-enhancement-run-progress")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL_MS));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("progressOnly"),
      undefined,
    );
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("shows the live run view immediately at mount, without requiring a click on Enhance with AI", () => {
    render(
      <AiEnhancementStage
        activeProgress={{
          totalBatches: 3,
          batches: [
            { index: 0, status: "succeeded" },
            { index: 1, status: "in-progress" },
            { index: 2, status: "pending" },
          ],
          startedAt: new Date().toISOString(),
          generatingSince: new Date().toISOString(),
          phase: "generating",
          cancelRequested: false,
        }}
        onAdvanced={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Enhancing…" })).toBeDisabled();
    expect(screen.getByTestId("ai-enhancement-run-progress")).toBeInTheDocument();
    expect(screen.getByLabelText("Batch progress")).toHaveTextContent(
      "Batch 2: In progress",
    );
    // Clicking is disabled, so there is no path left to the server's "already in progress"
    // rejection this behavior replaces.
    expect(
      screen.queryByRole("button", { name: "Enhance with AI" }),
    ).not.toBeInTheDocument();
  });

  it("keeps polling the resumed run and reports the outcome once it settles", async () => {
    const onAdvanced = vi.fn();
    // The `progressOnly` poll reports the run has settled (no `progress` field); the component
    // then makes one follow-up full-workflow fetch for the `onAdvanced` handoff (contracts/
    // ai-enhancement-progress-v2.md "progressOnly" addendum).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("progressOnly")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                progress: {
                  aiEnhancement: { status: "complete" },
                  liveScenarios: [],
                },
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              workflow: {
                activeStageId: "scenarioReview",
                stages: { aiEnhancement: { status: "complete" } },
              },
            }),
        });
      }),
    );

    render(
      <AiEnhancementStage
        activeProgress={{
          totalBatches: 2,
          batches: [
            { index: 0, status: "succeeded" },
            { index: 1, status: "in-progress" },
          ],
          startedAt: new Date().toISOString(),
          generatingSince: new Date().toISOString(),
          phase: "generating",
          cancelRequested: false,
        }}
        onAdvanced={onAdvanced}
      />,
    );

    await act(() => vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL_MS + 100));
    // The follow-up full-workflow fetch is a separate microtask hop beyond the poll tick itself;
    // flush it explicitly rather than relying on `advanceTimersByTimeAsync` alone.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        workflow: expect.objectContaining({ activeStageId: "scenarioReview" }),
      }),
    );
  });
});

/**
 * Phase, elapsed time and cancel for a run in progress (specs/013-ai-enhancement-viability FR-018,
 * FR-019, FR-020). Fake timers throughout, so elapsed time is asserted against a controlled clock
 * rather than real waiting (constitution XXIV).
 */
describe("AiEnhancementStage phase, elapsed time and cancel (specs/013-ai-enhancement-viability)", () => {
  const PROGRESS_POLL_INTERVAL_MS = 2000;
  const NOW = new Date("2026-10-14T10:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * The run POST never settles (the component stays in its running state); the `progressOnly` poll
   * returns `progress`; the cancel POST resolves with `cancelResponse`.
   */
  function stubRun(
    progress: unknown,
    cancelResponse: { ok: boolean; status: number; body: unknown } = {
      ok: true,
      status: 202,
      body: { workflow: {} },
    },
  ) {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: { method?: string } | null) => {
        if (init?.method === "POST" && url.endsWith("/ai-enhancement/cancel")) {
          return Promise.resolve({
            ok: cancelResponse.ok,
            status: cancelResponse.status,
            json: () => Promise.resolve(cancelResponse.body),
          });
        }
        if (init?.method === "POST") return new Promise(() => {});
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              progress: { aiEnhancement: { progress }, liveScenarios: [] },
            }),
        });
      });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function startRun() {
    render(<AiEnhancementStage onAdvanced={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    await act(() => vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL_MS));
  }

  const singleBatchGenerating = {
    totalBatches: 1,
    batches: [{ index: 0, status: "in-progress" }],
    startedAt: ago(20_000),
    generatingSince: ago(5_000),
    phase: "generating",
    cancelRequested: false,
  };

  const preparing = {
    totalBatches: 0,
    batches: [],
    startedAt: ago(42_000),
    phase: "preparing",
    cancelRequested: false,
  };

  it("shows the phase and a live elapsed timer for a single-batch run (FR-019, supersedes 012 FR-005)", async () => {
    stubRun(singleBatchGenerating);

    await startRun();

    expect(screen.getByTestId("ai-enhancement-phase")).toHaveTextContent("Generating scenarios");
    // generatingSince was 5 s before the clock was set, and the poll tick advanced it by 2 s.
    expect(screen.getByTestId("ai-enhancement-elapsed")).toHaveTextContent("7s elapsed");

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(screen.getByTestId("ai-enhancement-elapsed")).toHaveTextContent("10s elapsed");

    await act(() => vi.advanceTimersByTimeAsync(55_000));
    expect(screen.getByTestId("ai-enhancement-elapsed")).toHaveTextContent("1m 05s elapsed");
  });

  it("measures elapsed time from generatingSince, not from when the run started", async () => {
    stubRun({ ...singleBatchGenerating, startedAt: ago(600_000), generatingSince: ago(1_000) });

    await startRun();

    expect(screen.getByTestId("ai-enhancement-elapsed")).toHaveTextContent("3s elapsed");
  });

  it("renders the preparing phase distinctly from generating and attributes the wait to the model download (FR-018)", async () => {
    stubRun(preparing);

    await startRun();

    const phase = screen.getByTestId("ai-enhancement-phase");
    expect(phase).toHaveTextContent("Preparing the local model");
    expect(phase).not.toHaveTextContent("Generating scenarios");
    expect(screen.getByTestId("ai-enhancement-run-progress")).toHaveTextContent(/model downloads/i);
    // Preparation is timed from startedAt (there is no generatingSince yet).
    expect(screen.getByTestId("ai-enhancement-elapsed")).toHaveTextContent("44s elapsed");
  });

  it("shows no batch progress, and no NaN, while the model is still being prepared", async () => {
    stubRun(preparing);

    await startRun();

    expect(screen.queryByTestId("ai-enhancement-progress")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-enhancement-run-progress")).not.toHaveTextContent("NaN");
  });

  it("switches from the preparing view to the generating view when the phase advances", async () => {
    let current: unknown = preparing;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: { method?: string } | null) => {
        if (init?.method === "POST") return new Promise(() => {});
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              progress: { aiEnhancement: { progress: current }, liveScenarios: [] },
            }),
        });
      }),
    );
    await startRun();
    expect(screen.getByTestId("ai-enhancement-phase")).toHaveTextContent(
      "Preparing the local model",
    );

    current = { ...singleBatchGenerating, generatingSince: ago(0) };
    await act(() => vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL_MS));

    expect(screen.getByTestId("ai-enhancement-phase")).toHaveTextContent("Generating scenarios");
  });

  it("offers a cancel control only while a run is in progress", () => {
    stubRun(singleBatchGenerating);
    render(<AiEnhancementStage onAdvanced={() => {}} />);
    expect(screen.queryByTestId("ai-enhancement-cancel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("invokes the cancel endpoint without waiting for the run to settle, and says it is stopping (FR-020)", async () => {
    const fetchMock = stubRun({ ...singleBatchGenerating });
    await startRun();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The run POST is still pending (it never resolves in this stub); only the cancel call is awaited.
    await act(() => vi.advanceTimersByTimeAsync(0));

    const cancelCalls = fetchMock.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith("/ai-enhancement/cancel") && init?.method === "POST",
    );
    expect(cancelCalls).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });

  it("reports a refused cancel and re-enables the control so the user can try again", async () => {
    stubRun(singleBatchGenerating, {
      ok: false,
      status: 409,
      body: {
        error: "no_run_in_progress",
        message: "No AI enhancement run is currently in progress.",
      },
    });
    await startRun();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(screen.getByTestId("ai-enhancement-error")).toHaveTextContent(
      "No AI enhancement run",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("says the current batch will finish and the run then stop once the server reports the cancel", async () => {
    stubRun({ ...singleBatchGenerating, cancelRequested: true });

    await startRun();

    expect(screen.getByTestId("ai-enhancement-run-progress")).toHaveTextContent(
      "finishing the current batch, then stopping",
    );
    expect(screen.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  });

  it("hands control back as soon as the server settles the cancelled run, without waiting for any generation (SC-008)", async () => {
    let settleRun!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: { method?: string } | null) => {
        if (init?.method === "POST" && url.endsWith("/ai-enhancement/cancel")) {
          // Accepting the cancel is what lets the server release the pending run request.
          queueMicrotask(() =>
            settleRun({
              ok: true,
              status: 200,
              json: () =>
                Promise.resolve({
                  workflow: {
                    activeStageId: "scenarioReview",
                    stages: { aiEnhancement: { status: "partial", cancelled: true } },
                  },
                }),
            }),
          );
          return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({}) });
        }
        if (init?.method === "POST") {
          return new Promise((resolve) => {
            settleRun = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              progress: { aiEnhancement: { progress: singleBatchGenerating }, liveScenarios: [] },
            }),
        });
      }),
    );
    const onAdvanced = vi.fn();
    render(<AiEnhancementStage onAdvanced={onAdvanced} />);
    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    await act(() => vi.advanceTimersByTimeAsync(PROGRESS_POLL_INTERVAL_MS));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(onAdvanced).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        workflow: expect.objectContaining({ activeStageId: "scenarioReview" }),
      }),
    );
    // No run is being waited on any more: the progress view and cancel control are gone.
    expect(screen.queryByTestId("ai-enhancement-run-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-enhancement-cancel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enhance with AI" })).toBeEnabled();
  });
});
