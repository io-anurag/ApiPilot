import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FailureAnalysis, FailureAnalysisInProgress, SpecificationContext } from "@apipilot/shared-domain";
import { FailureAnalysisPanel } from "../../src/components/FailureAnalysisPanel";

function analysis(overrides: Partial<FailureAnalysis> = {}): FailureAnalysis {
  return {
    runId: "run-1",
    resultIndex: 1,
    requestName: "Create widget",
    requestMethod: "POST",
    conclusion: { kind: "likely-cause", cause: "environment-issue", confidence: 0.62 },
    summary: "The service could not reach its database.",
    investigationSteps: ["Check the database connection."],
    citedEvidenceIds: ["E1"],
    evidence: [
      { id: "E1", kind: "response-status", source: "run-result", text: "Response status 500" },
      { id: "E2", kind: "response-time", source: "run-result", text: "Response time 15 ms" },
    ],
    specificationContext: { status: "unavailable", reason: "not-generated-by-current-workflow" },
    provenance: {
      source: "AI",
      aiModel: "test-model",
      aiProvider: "local",
      responseVersion: 1,
      confidenceThreshold: 0.5,
      generatedAt: "2026-09-23T10:00:00.000Z",
    },
    ...overrides,
  };
}

/** Holds the parent-owned state the real run panel would hold, so the panel can be exercised alone. */
function Harness({
  initialAnalysis,
  initialInProgress = null,
}: Readonly<{ initialAnalysis?: FailureAnalysis; initialInProgress?: FailureAnalysisInProgress | null }>) {
  const [stored, setStored] = useState<FailureAnalysis | undefined>(initialAnalysis);
  const [inProgress, setInProgress] = useState<FailureAnalysisInProgress | null>(initialInProgress);
  return (
    <FailureAnalysisPanel
      collectionId="uc-1"
      runId="run-1"
      resultIndex={1}
      requestName="Create widget"
      analysis={stored}
      inProgress={inProgress}
      onAnalysisChange={setStored}
      onInProgressChange={(entry) => setInProgress(entry)}
    />
  );
}

interface Route {
  status: number;
  body: unknown;
}

function stubFetch(routes: { post?: Route | (() => Promise<Route>); inProgress?: () => Route }) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(`${init?.method ?? "GET"} ${url}`);
      let route: Route = { status: 204, body: null };
      if (init?.method === "POST" && routes.post) {
        route = typeof routes.post === "function" ? await routes.post() : routes.post;
      } else if (url.endsWith("/failure-analysis/in-progress") && routes.inProgress) {
        route = routes.inProgress();
      }
      return { ok: route.status < 400, status: route.status, json: () => Promise.resolve(route.body) };
    }),
  );
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FailureAnalysisPanel — US1", () => {
  it("offers an accessible Analyze action naming the request", () => {
    stubFetch({});
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Analyze failure: Create widget" })).toBeEnabled();
  });

  it("shows waiting, then generating, each with an elapsed timer, while the request is pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolvePost: ((route: Route) => void) | undefined;
    let phase: FailureAnalysisInProgress["phase"] = "waiting-for-ai";
    stubFetch({
      post: () =>
        new Promise<Route>((resolve) => {
          resolvePost = resolve;
        }),
      inProgress: () => ({
        status: 200,
        body: {
          inProgress: { runId: "run-1", resultIndex: 1, requestName: "Create widget", phase, phaseStartedAt: new Date().toISOString() },
        },
      }),
    });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze failure: Create widget" }));
    expect(await screen.findByText("Waiting for the local AI")).toBeInTheDocument();
    expect(screen.getByTestId("failure-analysis-progress")).toHaveTextContent(/\d+ s/);

    phase = "generating";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(await screen.findByText("Generating")).toBeInTheDocument();

    await act(async () => {
      resolvePost?.({ status: 200, body: { status: "analyzed", analysis: analysis() } });
    });
    expect(await screen.findByText("Potential environment issue")).toBeInTheDocument();
    expect(screen.queryByTestId("failure-analysis-progress")).not.toBeInTheDocument();
  });

  it("renders an analysis as a labelled inference with confidence, cited and other evidence, and steps", () => {
    stubFetch({});
    render(<Harness initialAnalysis={analysis()} />);

    expect(screen.getByText("AI inference, not a confirmed root cause")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Potential environment issue" })).toBeInTheDocument();
    expect(screen.getByText("Confidence: Moderate (0.62)")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Evidence cited" })).toHaveTextContent("Response status 500");
    const other = screen.getByText("Other evidence considered (1)").closest("details");
    expect(other).not.toHaveAttribute("open");
    expect(other).toHaveTextContent("Response time 15 ms");
    expect(screen.getByRole("region", { name: "Suggested next steps" })).toHaveTextContent("Check the database connection.");
    expect(screen.getByText(/Specification context unavailable/)).toHaveTextContent("not generated by the current guided workflow");
    expect(screen.getByRole("button", { name: "Analyze again: Create widget" })).toBeInTheDocument();
  });

  it("shows High for confidence of 0.75 and above", () => {
    stubFetch({});
    render(
      <Harness initialAnalysis={analysis({ conclusion: { kind: "likely-cause", cause: "specification-mismatch", confidence: 0.8 } })} />,
    );
    expect(screen.getByText("Confidence: High (0.80)")).toBeInTheDocument();
    expect(screen.getByText("Potential specification mismatch")).toBeInTheDocument();
  });

  it("disables Analyze while another analysis in the session is in progress, naming it", () => {
    stubFetch({});
    render(
      <Harness
        initialInProgress={{
          runId: "run-1",
          resultIndex: 7,
          requestName: "Delete widget",
          phase: "generating",
          phaseStartedAt: new Date().toISOString(),
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Analyze failure: Create widget" })).toBeDisabled();
    expect(screen.getByText("Analyzing ‘Delete widget’…")).toBeInTheDocument();
  });
});

describe("FailureAnalysisPanel — US2", () => {
  const matched: SpecificationContext = {
    status: "matched",
    workflowId: "tgw-1",
    scenarioId: "s-1",
    scenarioName: "GET /users/{id} with valid input",
    scenarioCategory: "positive",
    operationPath: "/users/{id}",
    operationMethod: "GET",
    documentedStatusCodes: ["200", "404"],
    requestEditedAfterGeneration: true,
    upstream: [
      {
        via: "integration-workflow",
        stepPosition: 0,
        operationPath: "/users",
        operationMethod: "POST",
        suppliedFields: ["user_id"],
        outcomeInRun: "failed",
      },
    ],
  };

  it("renders the matched operation, scenario, documented responses, edited note and upstream outcome in text", () => {
    stubFetch({});
    render(<Harness initialAnalysis={analysis({ specificationContext: matched })} />);
    const section = screen.getByRole("region", { name: "Specification context" });

    expect(section).toHaveTextContent("/users/{id}");
    expect(section.querySelector('[data-method="GET"]')).not.toBeNull();
    expect(section).toHaveTextContent("Scenario: GET /users/{id} with valid input (positive)");
    expect(section).toHaveTextContent("Documented responses: 200, 404");
    expect(section).toHaveTextContent("edited after generation");
    expect(section).toHaveTextContent("Step 1: POST /users (user_id) — failed");
  });

  it.each([
    ["no-request-identity", "recorded before ApiPilot tracked"],
    ["no-generated-collection", "no generated collection"],
    ["not-generated-by-current-workflow", "not generated by the current guided workflow"],
    ["no-originating-scenario", "without a test scenario"],
  ] as const)("explains the %s reason in plain language", (reason, text) => {
    stubFetch({});
    render(<Harness initialAnalysis={analysis({ specificationContext: { status: "unavailable", reason } })} />);
    expect(screen.getByRole("region", { name: "Specification context" })).toHaveTextContent(text);
  });
});

describe("FailureAnalysisPanel — US3", () => {
  it("shows insufficient evidence plainly, with model notes and no cause or confidence", () => {
    stubFetch({});
    render(
      <Harness
        initialAnalysis={analysis({
          conclusion: { kind: "insufficient-evidence", reason: "below-confidence-threshold", confidence: 0.3 },
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Not enough evidence to name a likely cause" })).toBeInTheDocument();
    expect(screen.getByText(/confidence in any single cause was too low/)).toBeInTheDocument();
    expect(screen.getByText("Model notes (inference)")).toBeInTheDocument();
    expect(screen.queryByText(/Confidence:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Potential environment issue")).not.toBeInTheDocument();
  });

  it.each([
    ["ai-failed", { status: "ai-failed", aiErrorCategory: "TIMEOUT", message: "The local AI model did not finish in time." }],
    [
      "not-viable",
      { status: "not-viable", notViable: { projectedMs: 200_000, budgetMs: 120_000 }, message: "This analysis would take too long." },
    ],
  ] as const)("shows the %s message with Try again, keeps the previous analysis, and moves focus to it", async (_label, body) => {
    stubFetch({ post: { status: 200, body } });
    render(<Harness initialAnalysis={analysis()} />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze again: Create widget" }));
    const error = await screen.findByTestId("failure-analysis-error");

    expect(error).toHaveTextContent(body.message);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByText("Potential environment issue")).toBeInTheDocument();
    await waitFor(() => expect(error.parentElement).toHaveFocus());
  });

  it("moves focus to the outcome heading when an analysis arrives", async () => {
    stubFetch({ post: { status: 200, body: { status: "analyzed", analysis: analysis() } } });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze failure: Create widget" }));
    const heading = await screen.findByRole("heading", { name: "Potential environment issue" });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
