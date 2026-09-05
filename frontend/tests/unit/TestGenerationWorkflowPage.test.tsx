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

  it("lets the user preview the starting page from an in-progress workflow, and return without discarding it (FR-010)", async () => {
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
      screen.getByRole("button", { name: "Start a new workflow from a different specification" }),
    );

    // Back on the starting page — no workflow content, no discard, no confirmation yet.
    expect(screen.getByText("Turn an OpenAPI specification into a test suite")).toBeInTheDocument();
    expect(screen.queryByTestId("api-review-stage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discard-existing-confirmation")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel — return to my in-progress workflow" }));

    expect(screen.getByTestId("api-review-stage")).toBeInTheDocument();
    expect(
      screen.queryByText("Turn an OpenAPI specification into a test suite"),
    ).not.toBeInTheDocument();
  });

  it("renders the AI-enhancement partial banner (not skipped) alongside scenario review when the stage status is 'partial' (FR-011)", async () => {
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

    await waitFor(() =>
      expect(screen.getByTestId("ai-enhancement-partial")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("ai-enhancement-skipped")).not.toBeInTheDocument();
    expect(screen.getByTestId("scenario-review-stage")).toBeInTheDocument();
  });
});
