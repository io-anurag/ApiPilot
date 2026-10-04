import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { analyzeChainPlan, type DebugRunResult, type Environment } from "@apipilot/shared-domain";
import { ChainDebugPanel, debugBlockedReason } from "../../src/components/requestChain/ChainDebugPanel";
import * as client from "../../src/services/requestChainClient";
import { failedExtractionResult } from "./debugRunFixtures";
import { lifecyclePlan } from "./requestChainFixtures";

/** AP-039 (specs/039-chain-debug-run tasks T041; FR-001, FR-017, FR-018, FR-023). */

vi.mock("../../src/services/requestChainClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/services/requestChainClient")>();
  return { ...original, debugRun: vi.fn(), revealDebugValue: vi.fn(), discardDebugRun: vi.fn(async () => ({ ok: true })) };
});

const ENVIRONMENT: Environment = { id: "e1", name: "Local stub", tier: "local", baseUrl: "http://127.0.0.1:4600", variableValues: { client_id: "x" }, requestDelayMs: 0 };
const debugRun = vi.mocked(client.debugRun);
const discardDebugRun = vi.mocked(client.discardDebugRun);

function renderPanel(overrides: { environment?: Environment | null; dirty?: boolean; loadRunInProgress?: boolean; names?: string[] | null } = {}) {
  const plan = lifecyclePlan();
  const analysis = analyzeChainPlan(plan, { environmentValueNames: overrides.names === undefined ? ["baseUrl", "client_id"] : overrides.names });
  return render(
    <ChainDebugPanel plan={plan} analysis={analysis} environment={overrides.environment === undefined ? ENVIRONMENT : overrides.environment} dirty={overrides.dirty ?? false} loadRunInProgress={overrides.loadRunInProgress ?? false} />,
  );
}

beforeEach(() => {
  debugRun.mockReset();
  discardDebugRun.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("Debug run trigger", () => {
  // The target, chains, hosts and write steps are described once for both runs, by the Run card
  // (ChainRunPanel.test.tsx); this panel only states what a Debug run does and when it sends.
  it("states that it sends real requests, names the environment on its button, and sends nothing until started", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Debug run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start debug run on Local stub" })).toBeEnabled();
    expect(screen.getByText(/real requests, including writes/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is sent until you start/)).toBeInTheDocument();
    expect(debugRun).not.toHaveBeenCalled();
  });

  it("warns about values the target lacks and still allows the run", () => {
    renderPanel({ names: ["baseUrl"] });
    expect(screen.getByTestId("debug-missing-values")).toHaveTextContent("client_id");
    expect(screen.getByRole("button", { name: /Start debug run on Local stub/ })).toBeEnabled();
  });

  it.each([
    [{ environment: null }, "Choose the target environment."],
    [{ dirty: true }, "Saving your latest change…"],
    [{ loadRunInProgress: true }, "A run is in progress."],
  ])("is blocked, with the reason, for %j", (props, reason) => {
    renderPanel(props);
    expect(screen.getByRole("button", { name: /Start debug run/ })).toBeDisabled();
    expect(screen.getByTestId("debug-blocked")).toHaveTextContent(reason);
  });

  it("is blocked while the plan has problems", () => {
    const plan = lifecyclePlan();
    plan.chains[0].steps[1].url = "not a url";
    render(<ChainDebugPanel plan={plan} analysis={analyzeChainPlan(plan, { environmentValueNames: null })} environment={ENVIRONMENT} dirty={false} loadRunInProgress={false} />);
    expect(screen.getByTestId("debug-blocked")).toHaveTextContent("Fix the plan's problems first.");
    expect(debugBlockedReason({ analysis: analyzeChainPlan(plan, { environmentValueNames: null }), environment: ENVIRONMENT, dirty: false, loadRunInProgress: false })).toBe("Fix the plan's problems first.");
  });
});

describe("Debug run lifecycle", () => {
  it("starts on the chosen environment, shows the output, and discards what the server held when closed", async () => {
    const result = failedExtractionResult();
    debugRun.mockResolvedValue({ ok: true, result });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Start debug run on Local stub/ }));
    expect(await screen.findByTestId("debug-run-output")).toBeInTheDocument();
    expect(debugRun).toHaveBeenCalledWith(expect.any(String), "e1", expect.any(AbortSignal));
    expect(screen.getByText("Stopped early")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close output" }));
    expect(screen.queryByTestId("debug-run-output")).not.toBeInTheDocument();
    expect(discardDebugRun).toHaveBeenCalledWith(expect.any(String), result.debugRunId);
  });

  it("offers Cancel while running, aborts the request, and returns to the start state", async () => {
    let signal: AbortSignal | undefined;
    debugRun.mockImplementation(
      (_planId, _environmentId, given) =>
        new Promise((resolve) => {
          signal = given;
          given?.addEventListener("abort", () => resolve({ ok: false, error: "aborted", message: "Cancelled." }));
        }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Start debug run/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Running the plan once…");
    fireEvent.click(screen.getByRole("button", { name: "Cancel debug run" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Start debug run/ })).toBeInTheDocument());
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByTestId("debug-run-error")).not.toBeInTheDocument();
  });

  it("shows a failure as an error, not as an empty result", async () => {
    debugRun.mockResolvedValue({ ok: false, error: "execution_in_progress", message: "Another execution run is in progress in this session." });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Start debug run/ }));
    expect(await screen.findByTestId("debug-run-error")).toHaveTextContent("Another execution run is in progress in this session.");
    expect(screen.queryByTestId("debug-run-output")).not.toBeInTheDocument();
  });

  it("aborts a run in flight and releases held values when the screen is left", async () => {
    let signal: AbortSignal | undefined;
    debugRun.mockImplementation((_p, _e, given) => {
      signal = given;
      return new Promise<never>(() => undefined);
    });
    const view = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Start debug run/ }));
    await screen.findByRole("status");
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("releases the previous output's values when another run starts", async () => {
    const first: DebugRunResult = failedExtractionResult();
    const second: DebugRunResult = failedExtractionResult({ debugRunId: "33333333-3333-4333-8333-333333333333" });
    debugRun.mockResolvedValueOnce({ ok: true, result: first }).mockResolvedValueOnce({ ok: true, result: second });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Start debug run/ }));
    await screen.findByTestId("debug-run-output");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Start debug run/ }));
    });
    await waitFor(() => expect(debugRun).toHaveBeenCalledTimes(2));
    expect(discardDebugRun).toHaveBeenCalledWith(expect.any(String), first.debugRunId);
  });

  it("reveals through the server for the run on screen", async () => {
    vi.mocked(client.revealDebugValue).mockResolvedValue({ ok: true, value: "Bearer tok-1" });
    debugRun.mockResolvedValue({ ok: true, result: failedExtractionResult() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Start debug run/ }));
    await screen.findByTestId("debug-run-output");
    fireEvent.click(screen.getByRole("button", { name: "Reveal Authorization header" }));
    await waitFor(() => expect(screen.getByTestId("revealed-value")).toHaveTextContent("Bearer tok-1"));
    expect(client.revealDebugValue).toHaveBeenCalledWith(expect.any(String), "22222222-2222-4222-8222-222222222222", "v1");
  });
});
