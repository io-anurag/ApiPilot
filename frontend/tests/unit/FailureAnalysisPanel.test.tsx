import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  FAILURE_RULE_DESCRIPTIONS,
  type FailureAnalysis,
  type FailureAnalysisInProgress,
  type SpecificationContext,
} from "@apipilot/shared-domain";
import { FailureAnalysisPanel } from "../../src/components/FailureAnalysisPanel";

function analysis(overrides: Partial<FailureAnalysis> = {}): FailureAnalysis {
  return {
    analysisVersion: 2,
    runId: "run-1",
    resultIndex: 1,
    requestName: "Create widget",
    requestMethod: "POST",
    conclusion: {
      kind: "likely-cause",
      cause: "environment-issue",
      strength: "moderate",
      ruleId: "gateway-error",
      decidingEvidenceIds: ["E1"],
    },
    classificationProvenance: { source: "RULE", ruleSetVersion: 1 },
    explanation: {
      status: "available",
      summary: "A gateway answered instead of the service.",
      investigationSteps: ["Check the gateway's upstream configuration."],
      citedEvidenceIds: ["E1"],
      provenance: { source: "AI", aiModel: "test-model", aiProvider: "local", responseVersion: 4 },
    },
    evidence: [
      { id: "E1", kind: "response-status", source: "run-result", text: "Response status 502" },
      { id: "E2", kind: "response-time", source: "run-result", text: "Response time 15 ms" },
    ],
    specificationContext: { status: "unavailable", reason: "not-generated-by-current-workflow" },
    analyzedAt: "2026-09-24T10:00:00.000Z",
    ...overrides,
  };
}

const unavailableExplanation: FailureAnalysis["explanation"] = {
  status: "unavailable",
  reason: { kind: "ai-error", aiErrorCategory: "TIMEOUT" },
  message: "The local AI model did not finish within 2 min, so no explanation was written.",
};

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

  it("shows a rule-decided cause with a RULE badge, a strength label with no number, and the rule", () => {
    stubFetch({});
    render(<Harness initialAnalysis={analysis()} />);

    const cause = screen.getByRole("region", { name: "Likely cause" });
    expect(within(cause).getByRole("heading", { name: "Potential environment issue" })).toBeInTheDocument();
    expect(cause.querySelector('[data-source="RULE"]')).not.toBeNull();
    expect(cause).toHaveTextContent("Strength: Moderate");
    expect(cause).not.toHaveTextContent(/\d\.\d/);
    expect(cause).toHaveTextContent(FAILURE_RULE_DESCRIPTIONS["gateway-error"]);
    expect(cause).toHaveTextContent("not a confirmed root cause");
    expect(screen.getByRole("region", { name: "Evidence for this cause" })).toHaveTextContent("Response status 502");
  });

  it("labels only the AI explanation as an inference, and puts everything else in Other evidence considered", () => {
    stubFetch({});
    render(<Harness initialAnalysis={analysis()} />);

    const explanation = screen.getByRole("region", { name: "AI explanation" });
    expect(explanation.querySelector('[data-source="AI"]')).not.toBeNull();
    expect(explanation).toHaveTextContent("AI inference, not a confirmed root cause");
    expect(explanation).toHaveTextContent("A gateway answered instead of the service.");
    expect(within(explanation).getByRole("region", { name: "Suggested next steps" })).toHaveTextContent(
      "Check the gateway's upstream configuration.",
    );
    const other = screen.getByText("Other evidence considered (1)").closest("details");
    expect(other).not.toHaveAttribute("open");
    expect(other).toHaveTextContent("Response time 15 ms");
    expect(screen.getByText(/Specification context unavailable/)).toHaveTextContent("not generated by the current guided workflow");
    expect(screen.getByRole("button", { name: "Analyze again: Create widget" })).toBeInTheDocument();
  });

  it("shows High for a high-strength rule", () => {
    stubFetch({});
    render(
      <Harness
        initialAnalysis={analysis({
          conclusion: {
            kind: "likely-cause",
            cause: "specification-mismatch",
            strength: "high",
            ruleId: "undocumented-status",
            decidingEvidenceIds: ["E1"],
          },
        })}
      />,
    );
    expect(screen.getByRole("region", { name: "Likely cause" })).toHaveTextContent("Strength: High");
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

  it("marks deciding evidence from the specification in text, not by colour alone", () => {
    stubFetch({});
    render(
      <Harness
        initialAnalysis={analysis({
          conclusion: {
            kind: "likely-cause",
            cause: "specification-mismatch",
            strength: "high",
            ruleId: "undocumented-status",
            decidingEvidenceIds: ["E1", "E3"],
          },
          evidence: [
            { id: "E1", kind: "response-status", source: "run-result", text: "Response status 200" },
            {
              id: "E3",
              kind: "documented-responses",
              source: "specification-context",
              text: "Operation GET /users/{id} documents responses: 201",
            },
          ],
          specificationContext: matched,
        })}
      />,
    );
    const deciding = screen.getByRole("region", { name: "Evidence for this cause" });
    const item = within(deciding).getByText("Operation GET /users/{id} documents responses: 201").closest("li");
    expect(item).toHaveTextContent("from the specification");
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
  it("shows insufficient evidence plainly: no rule matched, no strength, and the AI's cited evidence", () => {
    stubFetch({});
    render(<Harness initialAnalysis={analysis({ conclusion: { kind: "insufficient-evidence", reason: "no-rule-matched" } })} />);

    const cause = screen.getByRole("region", { name: "Likely cause" });
    expect(within(cause).getByRole("heading", { name: "Not enough evidence to name a likely cause" })).toBeInTheDocument();
    expect(cause).toHaveTextContent("No rule matched the recorded evidence.");
    expect(cause).not.toHaveTextContent("Strength");
    expect(screen.getByRole("region", { name: "Evidence cited" })).toHaveTextContent("Response status 502");
    expect(screen.queryByText("Potential environment issue")).not.toBeInTheDocument();
  });

  it("shows the cause and evidence with AI explanation unavailable and its reason", () => {
    stubFetch({});
    render(<Harness initialAnalysis={analysis({ explanation: unavailableExplanation })} />);

    expect(screen.getByRole("heading", { name: "Potential environment issue" })).toBeInTheDocument();
    const explanation = screen.getByRole("region", { name: "AI explanation" });
    expect(explanation).toHaveTextContent("AI explanation unavailable");
    expect(explanation).toHaveTextContent("did not finish within 2 min");
    expect(within(explanation).queryByRole("region", { name: "Suggested next steps" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analyze again: Create widget" })).toBeEnabled();
  });

  it("on kept-previous, keeps showing the previous analysis with a notice that the new explanation failed", async () => {
    const previous = analysis();
    stubFetch({
      post: {
        status: 200,
        body: {
          status: "kept-previous",
          analysis: analysis({ explanation: unavailableExplanation }),
          previousAnalysis: previous,
          message: "The local AI model did not finish within 2 min, so no explanation was written. The earlier explanation was kept.",
        },
      },
    });
    render(<Harness initialAnalysis={previous} />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze again: Create widget" }));
    const notice = await screen.findByTestId("failure-analysis-error");

    expect(notice).toHaveTextContent("The earlier explanation was kept.");
    expect(screen.getByRole("region", { name: "AI explanation" })).toHaveTextContent("A gateway answered instead of the service.");
    await waitFor(() => expect(notice.parentElement).toHaveFocus());
  });

  it("moves focus to the outcome heading when an analysis arrives", async () => {
    stubFetch({ post: { status: 200, body: { status: "analyzed", analysis: analysis() } } });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Analyze failure: Create widget" }));
    const heading = await screen.findByRole("heading", { name: "Potential environment issue" });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
