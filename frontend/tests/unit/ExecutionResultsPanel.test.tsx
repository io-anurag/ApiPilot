import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Environment, ExecutionRun } from "@apipilot/shared-domain";
import { ExecutionResultsPanel } from "../../src/components/ExecutionResultsPanel";

function env(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env-1",
    name: "Local",
    tier: "local",
    baseUrl: "http://localhost:4000",
    variableValues: {},
    requestDelayMs: 0,
    ...overrides,
  };
}

function completedRun(overrides: Partial<ExecutionRun> = {}): ExecutionRun {
  return {
    id: "run-1",
    workflowId: "wf-1",
    environmentId: "env-1",
    environmentSnapshot: { name: "Local", tier: "local", baseUrl: "http://localhost:4000" },
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    summary: { total: 1, passed: 1, failed: 0, notAttempted: 0, durationMs: 100 },
    results: [
      {
        scenarioId: "s-1",
        operationPath: "/pets",
        operationMethod: "GET",
        outcome: "passed",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 10,
        responseStatusCode: 200,
        assertionOutcomes: [],
      },
    ],
    cancelRequested: false,
    ...overrides,
  };
}

/** Routes fetch calls: GET /environments from `environments`, GET .../execution/runs (the run
 * history list, not a single run by id) to an empty list, everything else from `postQueue` in
 * order. */
function stubFetch(environments: Environment[], postQueue: unknown[]) {
  let postCallIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/environments")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ environments }) };
      }
      if (method === "GET" && url.endsWith("/execution/runs")) {
        return { ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) };
      }
      const response = postQueue[postCallIndex] ?? postQueue[postQueue.length - 1];
      postCallIndex += 1;
      return { ok: true, status: 200, json: () => Promise.resolve(response) };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExecutionResultsPanel", () => {
  it("shows the environment form when no environment is defined yet", async () => {
    stubFetch([], []);
    render(<ExecutionResultsPanel />);
    expect(await screen.findByTestId("environment-form")).toBeInTheDocument();
    expect(screen.queryByTestId("execution-env-select")).not.toBeInTheDocument();
  });

  it("auto-selects the only environment and starts a run, showing the growing results as they arrive", async () => {
    const environment = env();
    const inProgress = completedRun({ status: "in-progress", results: [], summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 } });
    const finished = completedRun();
    stubFetch([environment], [{ run: inProgress }, { run: finished }]);

    render(<ExecutionResultsPanel />);
    const runButton = await screen.findByRole("button", { name: "Run" });
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    await waitFor(() => expect(screen.getByTestId("execution-run-summary")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId("execution-run-summary")).toHaveTextContent("1 passed"),
    );
  });

  it("requires an explicit environment choice when more than one exists (FR-003)", async () => {
    stubFetch([env({ id: "env-1", name: "Local" }), env({ id: "env-2", name: "Staging", tier: "staging" })], []);
    render(<ExecutionResultsPanel />);

    const select = await screen.findByTestId("execution-env-select");
    expect(select).toHaveValue("");
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });

  it("filters to failures only and reveals per-request diagnostic detail on expand (US3, FR-016, FR-021)", async () => {
    const finished = completedRun({
      summary: { total: 2, passed: 1, failed: 1, notAttempted: 0, durationMs: 20 },
      results: [
        {
          scenarioId: "s-1",
          operationPath: "/pets",
          operationMethod: "GET",
          outcome: "passed",
          startedAt: "2026-01-01T00:00:00.000Z",
          durationMs: 5,
          responseStatusCode: 200,
          assertionOutcomes: [],
        },
        {
          scenarioId: "s-2",
          operationPath: "/pets",
          operationMethod: "POST",
          outcome: "failed",
          failureCategory: "unexpected-status",
          startedAt: "2026-01-01T00:00:00.000Z",
          durationMs: 8,
          responseStatusCode: 500,
          assertionOutcomes: [
            { assertionIndex: 0, type: "status-code", outcome: "failed", detail: "Expected status 201, got 500." },
          ],
        },
      ],
    });
    stubFetch([env()], [{ run: finished }]);

    render(<ExecutionResultsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    await screen.findByTestId("execution-run-summary");

    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show failures only" }));
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(1);
    expect(screen.getByText("/pets")).toBeInTheDocument();
    expect(screen.getByText("Unexpected status code")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(await screen.findByTestId("execution-result-detail")).toHaveTextContent(
      "Expected status 201, got 500.",
    );
  });

  it("shows a confirmation banner for a staging environment and proceeds once confirmed (US4, FR-007)", async () => {
    const staging = env({ tier: "staging" });
    const finished = completedRun({ environmentSnapshot: { name: "Staging", tier: "staging", baseUrl: "http://localhost:4000" } });
    let startCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        if (method === "GET" && url.endsWith("/environments")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ environments: [staging] }) };
        }
        if (method === "GET" && url.endsWith("/execution/runs")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) };
        }
        if (method === "POST" && url.endsWith("/execution/start")) {
          startCallCount += 1;
          if (startCallCount === 1) {
            return {
              ok: false,
              status: 409,
              json: () =>
                Promise.resolve({
                  error: "confirmation_required",
                  message: "confirm",
                  environmentTier: "staging",
                  destructiveOperations: [{ operationPath: "/pets", operationMethod: "DELETE" }],
                }),
            };
          }
          return { ok: true, status: 200, json: () => Promise.resolve({ run: finished }) };
        }
        return { ok: true, status: 200, json: () => Promise.resolve({ run: finished }) };
      }),
    );

    render(<ExecutionResultsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));

    const banner = await screen.findByTestId("execution-confirmation-banner");
    expect(banner).toHaveTextContent("staging");
    expect(banner).toHaveTextContent("/pets");

    fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));
    await screen.findByTestId("execution-run-summary");
    expect(screen.queryByTestId("execution-confirmation-banner")).not.toBeInTheDocument();
  });

  it("cancels an in-progress run via the Cancel run action (US4, FR-015)", async () => {
    const inProgress = completedRun({
      status: "in-progress",
      results: [],
      summary: { total: 0, passed: 0, failed: 0, notAttempted: 0, durationMs: 0 },
    });
    const cancelling = { ...inProgress, cancelRequested: true };
    stubFetch([env()], [{ run: inProgress }, { run: cancelling }]);

    render(<ExecutionResultsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Run" }));
    const cancelButton = await screen.findByRole("button", { name: "Cancel run" });

    fireEvent.click(cancelButton);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled());
  });

  it("lists run history and selecting a past run shows its full results again (US5, FR-019/FR-020)", async () => {
    const pastRun = completedRun({ id: "run-past", environmentSnapshot: { name: "Local", tier: "local", baseUrl: "http://localhost:4000" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/environments")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ environments: [env()] }) };
        }
        if (url.endsWith("/execution/runs")) {
          const summary = {
            id: pastRun.id,
            workflowId: pastRun.workflowId,
            environmentId: pastRun.environmentId,
            environmentSnapshot: pastRun.environmentSnapshot,
            status: pastRun.status,
            startedAt: pastRun.startedAt,
            completedAt: pastRun.completedAt,
            summary: pastRun.summary,
            cancelRequested: pastRun.cancelRequested,
          };
          return { ok: true, status: 200, json: () => Promise.resolve({ runs: [summary] }) };
        }
        if (url.endsWith(`/execution/runs/${pastRun.id}`)) {
          return { ok: true, status: 200, json: () => Promise.resolve({ run: pastRun }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<ExecutionResultsPanel />);
    const historyRow = await screen.findByRole("button", { name: /Local/ });
    fireEvent.click(historyRow);

    await waitFor(() =>
      expect(screen.getByTestId("execution-run-summary")).toHaveTextContent("1 passed"),
    );
  });
});
