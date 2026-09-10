import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TestGenerationWorkflowPage } from "../../src/pages/TestGenerationWorkflowPage";

const emptyApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

function baseStages() {
  const ids = [
    "upload",
    "analysis",
    "apiReview",
    "deterministicGeneration",
    "aiEnhancement",
    "scenarioReview",
    "dependencyAnalysis",
    "workflowReview",
    "postmanGeneration",
  ] as const;
  return Object.fromEntries(
    ids.map((id) => [id, { stageId: id, status: "not-yet-reached" }]),
  );
}

function workflowAt(activeStageId: string, overrides: Record<string, unknown> = {}) {
  const stages = baseStages() as Record<string, { stageId: string; status: string }>;
  stages[activeStageId] = { stageId: activeStageId, status: "active" };
  return {
    id: "wf-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeStageId,
    stages,
    specificationFilename: "valid.yaml",
    apiModel: emptyApiModel,
    ...overrides,
  };
}

/** Routes fetch calls to canned JSON responses; POST responses come from `postQueue`, in order. */
function stubFetch(postQueue: unknown[]) {
  let postCallIndex = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/api/test-generation-workflow")) {
        return { ok: true, status: 204, json: () => Promise.resolve(null) };
      }
      if (method === "POST") {
        const response = postQueue[postCallIndex];
        postCallIndex += 1;
        return { ok: true, status: 200, json: () => Promise.resolve(response) };
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }),
  );
}

describe("TestGenerationWorkflowPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the upload prompt when no workflow is in progress (FR-017)", async () => {
    stubFetch([]);

    render(<TestGenerationWorkflowPage />);

    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );
  });

  it("walks upload -> apiReview -> deterministicGeneration -> aiEnhancement -> scenarioReview", async () => {
    stubFetch([
      { workflow: workflowAt("apiReview") },
      { workflow: workflowAt("deterministicGeneration") },
      {
        workflow: workflowAt("aiEnhancement", {
          deterministicTestModel: { scenarios: [] },
        }),
      },
      {
        workflow: workflowAt("scenarioReview", {
          deterministicTestModel: { scenarios: [] },
          aiEnhancement: { aiProviderOutcome: "success" },
          reviewWorkspace: {
            workspaceRevision: 0,
            scenarios: [],
            summary: {
              total: 0,
              pending: 0,
              accepted: 0,
              rejected: 0,
              requiresReview: 0,
            },
            policy: { originsRequiringReview: ["AI", "USER"] },
          },
        }),
      },
    ]);

    render(<TestGenerationWorkflowPage />);
    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );

    const file = new File(["openapi: 3.0.3"], "valid.yaml", {
      type: "application/x-yaml",
    });
    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByTestId("api-review-stage")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByTestId("deterministic-generation-stage")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate Baseline Test Suite" }));
    await waitFor(() =>
      expect(screen.getByTestId("ai-enhancement-stage")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Enhance with AI" }));
    await waitFor(() =>
      expect(screen.getByTestId("scenario-review-stage")).toBeInTheDocument(),
    );
  });

  it("rejects a non-YAML file chosen via the native file picker's 'All Files' filter", async () => {
    stubFetch([]);

    render(<TestGenerationWorkflowPage />);
    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );

    const fetchMock = vi.mocked(fetch);
    const callsBefore = fetchMock.mock.calls.length;

    const file = new File(["not a spec"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), {
      target: { files: [file] },
    });

    expect(await screen.findByTestId("upload-error")).toHaveTextContent(
      "Only .yaml or .yml OpenAPI specification files are supported.",
    );
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("shows the workflow-level stage tracker once a workflow starts (User Story 2)", async () => {
    stubFetch([{ workflow: workflowAt("apiReview") }]);

    render(<TestGenerationWorkflowPage />);
    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );

    const file = new File(["openapi: 3.0.3"], "valid.yaml", {
      type: "application/x-yaml",
    });
    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("stage-status-apiReview")).toHaveTextContent("Active");
    expect(screen.getByTestId("stage-status-postmanGeneration")).toHaveTextContent(
      "Not yet reached",
    );
  });

  it("requires confirmation before discarding an in-progress workflow to start a new one (FR-010)", async () => {
    stubFetch([{ workflow: workflowAt("apiReview") }]);

    render(<TestGenerationWorkflowPage />);
    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );

    const file = new File(["openapi: 3.0.3"], "valid.yaml", {
      type: "application/x-yaml",
    });
    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(screen.getByTestId("api-review-stage")).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start a new workflow from a different specification",
      }),
    );

    // Clicking the button asks for confirmation immediately, before showing the starting page.
    expect(screen.getByTestId("discard-existing-confirmation")).toBeInTheDocument();
    expect(
      screen.queryByText("Turn an OpenAPI specification into a test suite"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("api-review-stage")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Cancelling the confirmation leaves the in-progress workflow untouched.
    expect(screen.queryByTestId("discard-existing-confirmation")).not.toBeInTheDocument();
    expect(screen.getByTestId("api-review-stage")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start a new workflow from a different specification",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));

    // Confirmed — now on the starting page, with the prior workflow's content gone.
    expect(
      screen.getByText("Turn an OpenAPI specification into a test suite"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("api-review-stage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discard-existing-confirmation")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel — return to my in-progress workflow" }),
    );

    expect(screen.getByTestId("api-review-stage")).toBeInTheDocument();
    expect(
      screen.queryByText("Turn an OpenAPI specification into a test suite"),
    ).not.toBeInTheDocument();
  });

  it("uploads with discardExisting when a file is chosen after confirming the discard (FR-010)", async () => {
    stubFetch([
      { workflow: workflowAt("apiReview") },
      { workflow: workflowAt("apiReview", { specificationFilename: "other.yaml" }) },
    ]);

    render(<TestGenerationWorkflowPage />);
    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), {
      target: {
        files: [
          new File(["openapi: 3.0.3"], "valid.yaml", { type: "application/x-yaml" }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("api-review-stage")).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start a new workflow from a different specification",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));

    const fetchMock = vi.mocked(fetch);
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.change(screen.getByLabelText("Upload OpenAPI specification"), {
      target: {
        files: [
          new File(["openapi: 3.0.3"], "other.yaml", { type: "application/x-yaml" }),
        ],
      },
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));

    const [url] = fetchMock.mock.calls[callsBefore];
    expect(String(url)).toContain("discardExisting=true");
  });

  it("renders the AI-enhancement partial banner (not skipped) on the AI Enhancement stage's own view, not cluttering scenario review, when the stage status is 'partial' (FR-011)", async () => {
    const stages = baseStages() as Record<
      string,
      {
        stageId: string;
        status: string;
        aiErrorCategory?: string;
        aiErrorMessage?: string;
      }
    >;
    stages.scenarioReview = { stageId: "scenarioReview", status: "active" };
    stages.aiEnhancement = {
      stageId: "aiEnhancement",
      status: "partial",
      aiErrorCategory: "TIMEOUT",
      aiErrorMessage: "provider timed out for 1 of 4 batches",
    };
    const workflow = {
      id: "wf-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeStageId: "scenarioReview",
      stages,
      specificationFilename: "valid.yaml",
      apiModel: emptyApiModel,
      deterministicTestModel: { scenarios: [] },
      reviewWorkspace: {
        workspaceRevision: 0,
        scenarios: [],
        summary: { total: 0, pending: 0, accepted: 0, rejected: 0, requiresReview: 0 },
        policy: { originsRequiringReview: ["AI", "USER"] },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/test-generation-workflow")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ workflow }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<TestGenerationWorkflowPage />);

    // Landing on scenario review (the real active stage) shows the review UI without the retry
    // banner — that would otherwise clutter a screen it doesn't belong to.
    await waitFor(() =>
      expect(screen.getByTestId("scenario-review-stage")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("ai-enhancement-partial")).not.toBeInTheDocument();

    // The retry banner lives on the AI Enhancement stage's own view instead, reachable via
    // "view" since the workflow already advanced past it.
    fireEvent.click(screen.getByTestId("stage-status-aiEnhancement"));
    expect(screen.getByTestId("ai-enhancement-partial")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-enhancement-skipped")).not.toBeInTheDocument();
    // The generic "nothing here can be changed" notice would contradict the retry banner right
    // above it, so it must not also render for this specific case.
    expect(screen.queryByTestId("read-only-stage-notice")).not.toBeInTheDocument();
  });

  it("lets a QA engineer look back read-only at completed apiReview, deterministicGeneration, aiEnhancement, and dependencyAnalysis stages (research.md D3 addendum)", async () => {
    const stages = baseStages() as Record<string, { stageId: string; status: string }>;
    stages.upload = { stageId: "upload", status: "complete" };
    stages.analysis = { stageId: "analysis", status: "complete" };
    stages.apiReview = { stageId: "apiReview", status: "complete" };
    stages.deterministicGeneration = {
      stageId: "deterministicGeneration",
      status: "complete",
    };
    stages.aiEnhancement = { stageId: "aiEnhancement", status: "complete" };
    stages.scenarioReview = { stageId: "scenarioReview", status: "complete" };
    stages.dependencyAnalysis = { stageId: "dependencyAnalysis", status: "complete" };
    stages.workflowReview = { stageId: "workflowReview", status: "active" };
    const workflow = {
      id: "wf-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeStageId: "workflowReview",
      stages,
      specificationFilename: "valid.yaml",
      apiModel: emptyApiModel,
      deterministicTestModel: { scenarios: [{ id: "s1" }, { id: "s2" }] },
      aiEnhancement: {
        aiProviderOutcome: "success",
        aiCandidates: {
          added: [{ id: "a1" }],
          deduplicated: [],
          rejected: [],
          nonExecutable: [],
        },
      },
      dependencyAnalysis: {
        requestId: "req-1",
        graph: { relationships: [{ id: "r1" }] },
        workflows: [],
        manualConfirmationCandidates: [],
        cycles: [],
        aiOutcome: "success",
        aiBatchingLimitation:
          "The AI-assisted pass ran across 3 separate units. A relationship whose producer and " +
          "consumer operations landed in different units could not be checked by AI and is not " +
          "confirmed absent — only deterministic matching and within-unit AI pairing were checked.",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/test-generation-workflow")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ workflow }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<TestGenerationWorkflowPage />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("stage-status-apiReview"));
    expect(screen.getByTestId("api-review-stage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.getByTestId("read-only-stage-notice")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("stage-status-deterministicGeneration"));
    expect(screen.getByTestId("deterministic-generation-summary")).toHaveTextContent(
      "2 baseline scenarios generated",
    );

    fireEvent.click(screen.getByTestId("stage-status-aiEnhancement"));
    expect(screen.getByTestId("ai-review-outcome")).toHaveTextContent(
      "1 AI-suggested scenario added to review",
    );

    fireEvent.click(screen.getByTestId("stage-status-dependencyAnalysis"));
    expect(screen.getByTestId("dependency-analysis-summary")).toHaveTextContent(
      "1 relationship found",
    );
    // FR-034: batching's coverage limitation must reach the user, not stay a backend-only detail.
    expect(screen.getByTestId("dependency-analysis-batching-limitation")).toHaveTextContent(
      "could not be checked by AI",
    );

    fireEvent.click(screen.getByTestId("stage-status-upload"));
    expect(screen.getByTestId("upload-stage-summary")).toHaveTextContent("valid.yaml");

    fireEvent.click(screen.getByTestId("stage-status-analysis"));
    expect(screen.getByTestId("analysis-stage-summary")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("stage-status-workflowReview"));
    expect(screen.getByTestId("workflow-review-stage")).toBeInTheDocument();
  });

  it("explains a pre-flight 'not viable' dependency-analysis refusal to the user, not just the logs", async () => {
    const stages = baseStages() as Record<string, { stageId: string; status: string }>;
    stages.dependencyAnalysis = { stageId: "dependencyAnalysis", status: "complete" };
    stages.workflowReview = { stageId: "workflowReview", status: "active" };
    const workflow = {
      id: "wf-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeStageId: "workflowReview",
      stages,
      specificationFilename: "valid.yaml",
      apiModel: emptyApiModel,
      dependencyAnalysis: {
        requestId: "req-1",
        graph: { relationships: [] },
        workflows: [],
        manualConfirmationCandidates: [],
        cycles: [],
        aiOutcome: "unavailable",
        aiErrorMessage:
          "The local AI model would need about 39s per unit, more than the configured 45s " +
          "budget. Deterministic relationships were used instead; nothing was run, so no time " +
          "was spent waiting.",
        notViable: { projectedMs: 39000, budgetMs: 45000 },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/test-generation-workflow")) {
          return { ok: true, status: 200, json: () => Promise.resolve({ workflow }) };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    render(<TestGenerationWorkflowPage />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("stage-status-dependencyAnalysis"));
    expect(screen.getByTestId("dependency-analysis-ai-error")).toHaveTextContent(
      "more than the configured 45s budget",
    );
  });
});
