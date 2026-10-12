import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TestGenerationWorkflowPage } from "../../src/pages/TestGenerationWorkflowPage";
import { openPhase } from "./workflowTrackerTestUtils";

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
    "execution",
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

/** Routes fetch calls to canned JSON responses; POST responses come from `postQueue`, in order.
 * DELETE (discard) answers 204 unless `deleteResponse` supplies a failure. */
function stubFetch(
  postQueue: unknown[],
  deleteResponse: { status: number; body: unknown } = { status: 204, body: null },
) {
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
      if (method === "DELETE" && url.includes("/api/test-generation-workflow")) {
        return {
          ok: deleteResponse.status < 400,
          status: deleteResponse.status,
          json: () => Promise.resolve(deleteResponse.body),
        };
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

  it("shows the session-expired notice, not the plain upload prompt, when the session's prior workflow was idle-evicted (specs/017-session-workflow-isolation FR-007a)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ workflow: null, sessionExpired: true }),
      })),
    );

    render(<TestGenerationWorkflowPage />);

    await waitFor(() =>
      expect(screen.getByTestId("session-expired-notice")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument();
  });

  it("shows the plain upload prompt, not the session-expired notice, for an ordinary empty session", async () => {
    stubFetch([]);

    render(<TestGenerationWorkflowPage />);

    await waitFor(() =>
      expect(screen.getByLabelText("Upload OpenAPI specification")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("session-expired-notice")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("workflow-position")).toHaveTextContent(
      "Step 3 of 11 · Prepare › API Review",
    );
    openPhase("execute");
    expect(screen.getByTestId("stage-status-postmanGeneration")).toHaveTextContent(
      "Not yet reached",
    );
  });

  async function renderWithWorkflowInProgress() {
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
  }

  function deleteCalls() {
    return vi
      .mocked(fetch)
      .mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
      );
  }

  it("requires confirmation before discarding an in-progress workflow, then discards it on the server immediately (FR-010)", async () => {
    stubFetch([{ workflow: workflowAt("apiReview") }]);
    await renderWithWorkflowInProgress();

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
    expect(deleteCalls()).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start a new workflow from a different specification",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));

    // Confirmed — the workflow is discarded on the server, and the starting page offers no way
    // back to it.
    expect(
      await screen.findByText("Turn an OpenAPI specification into a test suite"),
    ).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(1);
    expect(String(deleteCalls()[0][0])).toContain("/api/test-generation-workflow");
    expect(screen.queryByTestId("api-review-stage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discard-existing-confirmation")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Cancel — return to my in-progress workflow",
      }),
    ).not.toBeInTheDocument();
  });

  it("uploads a new specification without discardExisting once the discard has already happened", async () => {
    stubFetch([
      { workflow: workflowAt("apiReview") },
      { workflow: workflowAt("apiReview", { specificationFilename: "other.yaml" }) },
    ]);
    await renderWithWorkflowInProgress();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start a new workflow from a different specification",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));
    await screen.findByText("Turn an OpenAPI specification into a test suite");

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
    expect(String(url)).not.toContain("discardExisting");
  });

  it("keeps the workflow and explains why when the server refuses the discard", async () => {
    stubFetch([{ workflow: workflowAt("apiReview") }], {
      status: 409,
      body: {
        error: "ai_enhancement_running",
        message:
          "AI enhancement is still running. Cancel it and wait for it to stop before discarding this workflow.",
      },
    });
    await renderWithWorkflowInProgress();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Start a new workflow from a different specification",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard and start new" }));

    expect(await screen.findByTestId("discard-error")).toHaveTextContent(
      "AI enhancement is still running",
    );
    expect(screen.getByTestId("discard-existing-confirmation")).toBeInTheDocument();
    expect(screen.getByTestId("api-review-stage")).toBeInTheDocument();
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
    openPhase("design");
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

    openPhase("prepare");
    fireEvent.click(screen.getByTestId("stage-status-apiReview"));
    expect(screen.getByTestId("api-review-stage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    expect(screen.getByTestId("read-only-stage-notice")).toBeInTheDocument();

    openPhase("design");
    fireEvent.click(screen.getByTestId("stage-status-deterministicGeneration"));
    expect(screen.getByTestId("deterministic-generation-summary")).toHaveTextContent(
      "2 baseline scenarios generated",
    );

    fireEvent.click(screen.getByTestId("stage-status-aiEnhancement"));
    expect(screen.getByTestId("ai-review-outcome")).toHaveTextContent(
      "1 AI-suggested scenario added to review",
    );

    openPhase("organize");
    fireEvent.click(screen.getByTestId("stage-status-dependencyAnalysis"));
    expect(screen.getByTestId("dependency-analysis-summary")).toHaveTextContent(
      "1 relationship found",
    );
    // FR-034: batching's coverage limitation must reach the user, not stay a backend-only detail.
    expect(
      screen.getByTestId("dependency-analysis-batching-limitation"),
    ).toHaveTextContent("could not be checked by AI");

    openPhase("prepare");
    fireEvent.click(screen.getByTestId("stage-status-upload"));
    expect(screen.getByTestId("upload-stage-summary")).toHaveTextContent("valid.yaml");

    fireEvent.click(screen.getByTestId("stage-status-analysis"));
    expect(screen.getByTestId("analysis-stage-summary")).toBeInTheDocument();

    openPhase("organize");
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

  describe("execution stage handoff (requirement: guided workflow hands off to Import & Run Collection)", () => {
    const postmanArtifact = {
      collection: { info: { name: "c" }, item: [] },
      environment: { values: [] },
      readme: "readme text",
      summary: { requestCount: 3, folderCount: 1, byProvenance: { RULE: 3, AI: 0 } },
      limitations: [],
    };

    function executionWorkflow() {
      const stages = baseStages() as Record<string, { stageId: string; status: string }>;
      stages.postmanGeneration = { stageId: "postmanGeneration", status: "complete" };
      stages.execution = { stageId: "execution", status: "active" };
      return {
        id: "wf-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        activeStageId: "execution",
        stages,
        specificationFilename: "valid.yaml",
        apiModel: emptyApiModel,
        postmanArtifact,
      };
    }

    function stubExecutionFetch(workflow: unknown) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          const method = init?.method ?? "GET";
          if (method === "GET" && url.endsWith("/api/test-generation-workflow")) {
            return { ok: true, status: 200, json: () => Promise.resolve({ workflow }) };
          }
          throw new Error(`Unexpected fetch: ${method} ${url}`);
        }),
      );
    }

    it("shows a handoff notice instead of running anything itself, and never renders the Postman Generation form for it", async () => {
      stubExecutionFetch(executionWorkflow());

      render(<TestGenerationWorkflowPage />);
      await waitFor(() =>
        expect(screen.getByTestId("execution-handoff-notice")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("postman-generation-stage")).not.toBeInTheDocument();
    });

    it("calls onHandoffToExecution automatically once resumed directly onto the execution stage", async () => {
      stubExecutionFetch(executionWorkflow());
      const onHandoffToExecution = vi.fn();

      render(<TestGenerationWorkflowPage onHandoffToExecution={onHandoffToExecution} />);

      await waitFor(() =>
        expect(onHandoffToExecution).toHaveBeenCalledWith(
          postmanArtifact,
          undefined,
          expect.stringMatching(/^wf-/),
        ),
      );
    });

    it("shows the requested stage instead of handing off or landing on execution (Coverage's Open scenarios)", async () => {
      stubExecutionFetch(executionWorkflow());
      const onHandoffToExecution = vi.fn();

      render(
        <TestGenerationWorkflowPage
          onHandoffToExecution={onHandoffToExecution}
          stageRequest={{ stageId: "scenarioReview", token: 1 }}
        />,
      );

      await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
      expect(screen.queryByTestId("execution-handoff-notice")).not.toBeInTheDocument();
      expect(onHandoffToExecution).not.toHaveBeenCalled();
    });

    it("the handoff notice's own button re-triggers the handoff on demand", async () => {
      stubExecutionFetch(executionWorkflow());
      const onHandoffToExecution = vi.fn();

      render(<TestGenerationWorkflowPage onHandoffToExecution={onHandoffToExecution} />);
      await waitFor(() =>
        expect(screen.getByTestId("execution-handoff-notice")).toBeInTheDocument(),
      );
      onHandoffToExecution.mockClear();

      fireEvent.click(
        screen.getByRole("button", { name: "Go to Import & Run Collection" }),
      );
      expect(onHandoffToExecution).toHaveBeenCalledWith(
        postmanArtifact,
        undefined,
        expect.stringMatching(/^wf-/),
      );
    });

    it("still shows the interactive Postman Generation form with download links when revisited after advancing to execution", async () => {
      stubExecutionFetch(executionWorkflow());

      render(<TestGenerationWorkflowPage />);
      await waitFor(() =>
        expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByTestId("stage-status-postmanGeneration"));
      expect(screen.getByTestId("postman-generation-stage")).toBeInTheDocument();
      expect(screen.getByTestId("postman-generation-downloads")).toBeInTheDocument();
      // Regenerable, not read-only — the generic "nothing here can be changed" notice must not
      // apply to a stage that stays fully interactive.
      expect(screen.queryByTestId("read-only-stage-notice")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Generate Postman Collection" }),
      ).toBeEnabled();
    });

    it("stays on the Postman Generation success screen after generating, only handing off once the user clicks Continue", async () => {
      const workflowAtPostmanGeneration = {
        id: "wf-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        activeStageId: "postmanGeneration",
        stages: (() => {
          const stages = baseStages() as Record<
            string,
            { stageId: string; status: string }
          >;
          stages.postmanGeneration = { stageId: "postmanGeneration", status: "active" };
          return stages;
        })(),
        specificationFilename: "valid.yaml",
        apiModel: emptyApiModel,
      };
      const generatedWorkflow = executionWorkflow();
      const onHandoffToExecution = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          const method = init?.method ?? "GET";
          if (method === "GET" && url.endsWith("/api/test-generation-workflow")) {
            return {
              ok: true,
              status: 200,
              json: () => Promise.resolve({ workflow: workflowAtPostmanGeneration }),
            };
          }
          if (method === "POST" && url.endsWith("/postman-generation")) {
            return {
              ok: true,
              status: 200,
              json: () => Promise.resolve({ workflow: generatedWorkflow }),
            };
          }
          throw new Error(`Unexpected fetch: ${method} ${url}`);
        }),
      );

      render(<TestGenerationWorkflowPage onHandoffToExecution={onHandoffToExecution} />);
      await waitFor(() =>
        expect(screen.getByTestId("postman-generation-stage")).toBeInTheDocument(),
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Generate Postman Collection" }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("postman-generation-success")).toBeInTheDocument(),
      );
      // The workflow already advanced server-side, but the view must not jump away —
      // downloads stay reachable until the user is done with them.
      expect(screen.queryByTestId("execution-handoff-notice")).not.toBeInTheDocument();
      expect(onHandoffToExecution).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByRole("button", { name: "Continue to Import & Run Collection" }),
      );

      expect(onHandoffToExecution).toHaveBeenCalledWith(
        postmanArtifact,
        undefined,
        expect.stringMatching(/^wf-/),
      );
      expect(screen.getByTestId("execution-handoff-notice")).toBeInTheDocument();
    });
  });
});

/** specs/048-workflow-run-stage-status US3: the page stays mounted while hidden, so it refetches on becoming visible and while waiting. */
describe("TestGenerationWorkflowPage freshness (specs/048)", () => {
  const REFRESH_MS = 5000;

  function executeWorkflow(
    statuses: { execution?: string; performanceTesting?: string },
    updatedAt: string,
  ) {
    const stages = baseStages() as Record<string, { stageId: string; status: string }>;
    for (const id of Object.keys(stages))
      stages[id] = { stageId: id, status: "complete" };
    stages.execution = { stageId: "execution", status: statuses.execution ?? "active" };
    stages.performanceTesting = {
      stageId: "performanceTesting",
      status: statuses.performanceTesting ?? "not-yet-reached",
    };
    return workflowAt("execution", { id: "wf-fresh", updatedAt, stages });
  }

  /** GET answers with whatever `server.current` holds at that moment; null answers 204. */
  function stubServer(server: { current: unknown }) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") throw new Error("Unexpected non-GET fetch");
      if (server.current === "fail") throw new Error("offline");
      if (server.current === null)
        return { ok: true, status: 204, json: () => Promise.resolve(null) };
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ workflow: server.current }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function executionStatusText(): string {
    openPhase("execute");
    return screen.getByTestId("stage-status-execution").textContent ?? "";
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refetches when it becomes visible and shows an Execution that is now Complete", async () => {
    const server = {
      current: executeWorkflow({}, "2026-01-01T00:00:00.000Z") as unknown,
    };
    const fetchMock = stubServer(server);
    const view = render(<TestGenerationWorkflowPage isVisible={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );
    expect(executionStatusText()).toContain("Active");
    const callsWhileHidden = fetchMock.mock.calls.length;

    server.current = executeWorkflow(
      { execution: "complete" },
      "2026-01-01T00:05:00.000Z",
    );
    view.rerender(<TestGenerationWorkflowPage isVisible />);

    await waitFor(() => expect(executionStatusText()).toContain("Complete"));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsWhileHidden);
  });

  it("does not fetch while hidden, however long it waits", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = {
      current: executeWorkflow({}, "2026-01-01T00:00:00.000Z") as unknown,
    };
    const fetchMock = stubServer(server);
    render(<TestGenerationWorkflowPage isVisible={false} />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );
    const callsAfterMount = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    });
    expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("does not fetch while the browser tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = {
      current: executeWorkflow({}, "2026-01-01T00:00:00.000Z") as unknown,
    };
    const fetchMock = stubServer(server);
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );
    const callsAfterMount = fetchMock.mock.calls.length;

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
      });
      expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
    } finally {
      visibility.mockRestore();
    }
  });

  it("refetches every 5 seconds while visible and waiting, then stops once both stages have finished", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = {
      current: executeWorkflow({}, "2026-01-01T00:00:00.000Z") as unknown,
    };
    const fetchMock = stubServer(server);
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );

    server.current = executeWorkflow(
      { execution: "complete" },
      "2026-01-01T00:01:00.000Z",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    });
    await waitFor(() => expect(executionStatusText()).toContain("Complete"));

    // Performance Testing still pending: it keeps asking.
    const before = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);

    server.current = executeWorkflow(
      { execution: "complete", performanceTesting: "complete" },
      "2026-01-01T00:02:00.000Z",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    });
    const settledCalls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    });
    expect(fetchMock.mock.calls.length).toBe(settledCalls);
  });

  it("leaves the screen unchanged when the refetch returns nothing or fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = {
      current: executeWorkflow({}, "2026-01-01T00:00:00.000Z") as unknown,
    };
    stubServer(server);
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );

    for (const answer of [null, "fail"]) {
      server.current = answer;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
      });
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument();
      expect(executionStatusText()).toContain("Active");
    }
  });

  it("shows one consistent Execution status in the tracker and the step position (FR-012)", async () => {
    const server = {
      current: executeWorkflow(
        { execution: "complete" },
        "2026-01-01T00:05:00.000Z",
      ) as unknown,
    };
    stubServer(server);
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );
    expect(executionStatusText()).toContain("Complete");
    expect(screen.getByTestId("workflow-position")).toHaveTextContent("Execution");
    expect(executionStatusText()).not.toContain("Active");
  });
});

/** Revisiting and following stages while server-side work is still running in the background. */
describe("TestGenerationWorkflowPage background stages", () => {
  const REFRESH_MS = 5000;

  const aiProgress = {
    totalBatches: 0,
    batches: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    phase: "preparing",
    cancelRequested: false,
  };

  /** AI enhancement still running after the workflow already advanced to scenarioReview. */
  function aiRunningWorkflow(updatedAt = "2026-01-01T00:00:00.000Z") {
    const wf = workflowAt("scenarioReview", { updatedAt });
    wf.stages.aiEnhancement = {
      stageId: "aiEnhancement",
      status: "active",
      progress: aiProgress,
    } as (typeof wf.stages)["aiEnhancement"];
    return wf;
  }

  function stubServer(server: { current: unknown }) {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") throw new Error("Unexpected non-GET fetch");
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ workflow: server.current }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens the live progress view for an AI Enhancement run still in flight, not a blank screen", async () => {
    stubServer({ current: aiRunningWorkflow() });
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );

    openPhase("design");
    const chip = screen.getByTestId("stage-status-aiEnhancement");
    expect(chip).toHaveTextContent("Active — view");
    fireEvent.click(chip);

    expect(await screen.findByTestId("ai-enhancement-run-progress")).toBeInTheDocument();
    // Resumes observing the run; it must not offer to start a second one.
    expect(
      screen.queryByRole("button", { name: "Enhance with AI" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("read-only-stage-notice")).not.toBeInTheDocument();
  });

  it("keeps a pending batch retry live when workflow refresh changes the stage from partial to active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const partial = workflowAt("scenarioReview");
    partial.stages.aiEnhancement = {
      stageId: "aiEnhancement",
      status: "partial",
      batchOutcomes: [
        {
          index: 0,
          operationKeys: ["GET /items"],
          status: "failed",
          failureExplanation: {
            category: "unusable-output",
            summary: "The AI reply could not be used.",
            nextStep: "Retry this batch.",
            retryable: true,
          },
        },
      ],
    } as (typeof partial.stages)["aiEnhancement"];
    const server = { current: partial };
    let finishRetry = () => {};
    const retryFinished = new Promise<void>((resolve) => {
      finishRetry = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") {
        server.current = aiRunningWorkflow("2026-01-01T00:01:00.000Z");
        await retryFinished;
      }
      return {
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            url.includes("progressOnly")
              ? {
                  progress: {
                    aiEnhancement: { status: "active", progress: aiProgress },
                    liveScenarios: [],
                  },
                }
              : { workflow: server.current },
          ),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );
    openPhase("design");
    fireEvent.click(screen.getByTestId("stage-status-aiEnhancement"));
    fireEvent.click(screen.getByRole("button", { name: "Retry batch 1" }));
    expect(screen.getByRole("button", { name: "Retry AI enhancement" })).toBeDisabled();

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByRole("button", { name: "Enhancing…" })).toBeDisabled();
    expect(screen.getByTestId("ai-enhancement-run-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("read-only-stage-notice")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(REFRESH_MS + 100));
    fireEvent.click(screen.getByRole("button", { name: "Enhancing…" }));
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);

    const settled = workflowAt("scenarioReview", {
      updatedAt: "2026-01-01T00:02:00.000Z",
    });
    settled.stages.aiEnhancement = { stageId: "aiEnhancement", status: "complete" };
    await act(async () => {
      server.current = settled;
      finishRetry();
    });
    expect(screen.getByTestId("stage-status-aiEnhancement")).toHaveTextContent(
      "Complete",
    );
    expect(screen.queryByTestId("ai-enhancement-error")).not.toBeInTheDocument();
  });

  it("keeps refreshing while AI enhancement runs in the background, and stops once it settles", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = { current: aiRunningWorkflow() as unknown };
    const fetchMock = stubServer(server);
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-stage-tracker")).toBeInTheDocument(),
    );

    const before = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);

    const settled = workflowAt("scenarioReview", {
      updatedAt: "2026-01-01T00:05:00.000Z",
    });
    settled.stages.aiEnhancement = { stageId: "aiEnhancement", status: "complete" };
    server.current = settled;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    });
    openPhase("design");
    await waitFor(() =>
      expect(screen.getByTestId("stage-status-aiEnhancement")).toHaveTextContent(
        "Complete",
      ),
    );

    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS * 3);
    });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("explains a running Dependency Analysis, then follows the workflow to Workflow Review when it finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = {
      current: workflowAt("dependencyAnalysis", {
        updatedAt: "2026-01-01T00:00:00.000Z",
      }) as unknown,
    };
    stubServer(server);
    render(<TestGenerationWorkflowPage isVisible />);

    expect(
      await screen.findByTestId("dependency-analysis-in-progress"),
    ).toBeInTheDocument();

    const done = workflowAt("workflowReview", {
      updatedAt: "2026-01-01T00:05:00.000Z",
      dependencyAnalysis: {
        workflows: [],
        manualConfirmationCandidates: [],
        graph: { relationships: [] },
        cycles: [],
      },
    });
    done.stages.dependencyAnalysis = {
      stageId: "dependencyAnalysis",
      status: "complete",
    };
    server.current = done;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    });

    await waitFor(() =>
      expect(screen.getByTestId("workflow-position")).toHaveTextContent(
        "Workflow Review",
      ),
    );
    expect(
      screen.queryByTestId("dependency-analysis-in-progress"),
    ).not.toBeInTheDocument();
  });

  it("does not pull the user off another stage's screen when the active stage advances on refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Postman is complete but the user has not continued yet, so the page keeps polling.
    const onPostman = workflowAt("postmanGeneration", {
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    onPostman.stages.postmanGeneration = {
      stageId: "postmanGeneration",
      status: "complete",
    };
    const server = { current: onPostman as unknown };
    const fetchMock = stubServer(server);
    render(<TestGenerationWorkflowPage isVisible />);
    await waitFor(() =>
      expect(screen.getByTestId("workflow-position")).toHaveTextContent(
        "Postman Generation",
      ),
    );

    // Server moves on (e.g. Postman Generation finished elsewhere); the page must stay put until
    // the user chooses to continue.
    const advanced = workflowAt("execution", { updatedAt: "2026-01-01T00:05:00.000Z" });
    advanced.stages.postmanGeneration = {
      stageId: "postmanGeneration",
      status: "complete",
    };
    server.current = advanced;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_MS + 100);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    expect(screen.getByTestId("workflow-position")).toHaveTextContent(
      "Postman Generation",
    );
  });
});
