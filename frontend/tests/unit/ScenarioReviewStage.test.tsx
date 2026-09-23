import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { ScenarioReviewStage } from "../../src/components/ScenarioReviewStage";
import * as client from "../../src/services/testGenerationWorkflowClient";

function workflowAt(activeStageId: string): TestGenerationWorkflow {
  return {
    id: "wf-1",
    activeStageId,
    reviewWorkspace: {
      workspaceRevision: 0,
      scenarios: [],
      summary: { total: 0, pending: 0, accepted: 0, rejected: 0, requiresReview: 0 },
      policy: { originsRequiringReview: ["AI", "USER"] },
    },
  } as unknown as TestGenerationWorkflow;
}

function workflowWithScenario(): TestGenerationWorkflow {
  return {
    id: "wf-1",
    activeStageId: "scenarioReview",
    apiModel: {
      operations: [
        {
          path: "/api/v1/users",
          method: "POST",
          operationId: undefined,
          parameters: [],
          requestBody: undefined,
          responses: [],
          security: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }],
          tags: [],
        },
      ],
      securitySchemes: {},
      summary: { operationCount: 1, schemaCount: 0, securitySchemeCount: 1, issues: [] },
    },
    reviewWorkspace: {
      workspaceRevision: 0,
      scenarios: [
        {
          scenarioId: "s1",
          revision: 0,
          state: "pending",
          isUserModified: false,
          history: [],
          scenario: {
            id: "s1",
            operationPath: "/api/v1/users",
            operationMethod: "POST",
            category: "positive",
            request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { name: "a" } },
            displayRequest: { pathParameters: {}, queryParameters: {}, headers: {}, body: { name: "a" } },
            assertions: [],
            provenance: { source: "RULE", rule: "positive-request", description: "Happy path", duplicateOfRules: [] },
          },
        },
      ],
      summary: { total: 1, pending: 1, accepted: 0, rejected: 0, requiresReview: 0 },
      policy: { originsRequiringReview: ["AI", "USER"] },
    },
  } as unknown as TestGenerationWorkflow;
}

describe("ScenarioReviewStage", () => {
  it("shows Finalize Review when scenarioReview is the active stage", () => {
    render(
      <ScenarioReviewStage workflow={workflowAt("scenarioReview")} onAdvanced={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Finalize Review" })).toBeInTheDocument();
  });

  it("hides Finalize Review while merely revisiting an already-completed scenarioReview, so it can't be clicked before a decision reopens it", () => {
    render(
      <ScenarioReviewStage workflow={workflowAt("workflowReview")} onAdvanced={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: /^Finalize Review/ }),
    ).not.toBeInTheDocument();
  });

  it("passes the scenario's matching operation through so its security requirement is shown, not just an empty headers object", () => {
    render(<ScenarioReviewStage workflow={workflowWithScenario()} onAdvanced={vi.fn()} />);

    fireEvent.click(screen.getByTestId("review-scenario-row-s1"));

    expect(screen.getByTestId("review-scenario-security")).toHaveTextContent(
      "Requires authentication (bearerAuth)",
    );
  });
});

describe("ScenarioReviewStage summary", () => {
  function reviewScenario(id: string, category: string, state: "pending" | "accepted" | "rejected") {
    const request = { pathParameters: {}, queryParameters: {}, headers: {} };
    return {
      scenarioId: id,
      revision: 0,
      state,
      isUserModified: false,
      history: [],
      scenario: {
        id,
        operationPath: "/health",
        operationMethod: "GET",
        category,
        request,
        displayRequest: request,
        assertions: [],
        provenance: { source: "RULE", rule: category, description: id, duplicateOfRules: [] },
      },
    };
  }

  it("counts and breaks down only accepted scenarios, since only they are finalized", () => {
    const workflow = {
      id: "wf-1",
      activeStageId: "scenarioReview",
      reviewWorkspace: {
        workspaceRevision: 0,
        scenarios: [
          reviewScenario("a1", "positive", "accepted"),
          reviewScenario("a2", "missing-field", "accepted"),
          reviewScenario("p1", "invalid-type", "pending"),
          reviewScenario("r1", "numeric-boundary", "rejected"),
        ],
        summary: { total: 4, pending: 1, accepted: 2, rejected: 1, requiresReview: 0 },
        policy: { originsRequiringReview: ["AI", "USER"] },
      },
    } as unknown as TestGenerationWorkflow;
    render(<ScenarioReviewStage workflow={workflow} onAdvanced={vi.fn()} />);

    const panel = screen.getByTestId("scenario-review-summary-panel");
    const label = within(panel).getByText("of 4 scenarios accepted");
    expect(label.previousElementSibling?.textContent).toBe("2");
    const counts = Object.fromEntries(
      within(panel)
        .getAllByRole("term")
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(counts).toEqual({
      Positive: "1",
      "Missing Required": "1",
      "Invalid / Negative": "0",
      Boundary: "0",
    });
  });
});

describe("ScenarioReviewStage finalize confirmation", () => {
  it("counts the accepted scenarios being finalized on the confirm button, not the pending ones excluded", () => {
    const request = { pathParameters: {}, queryParameters: {}, headers: {} };
    const item = (id: string, state: "pending" | "accepted") => ({
      scenarioId: id,
      revision: 0,
      state,
      isUserModified: false,
      history: [],
      scenario: {
        id,
        operationPath: "/health",
        operationMethod: "GET",
        category: "positive",
        request,
        displayRequest: request,
        assertions: [],
        provenance: { source: "RULE", rule: "positive", description: id, duplicateOfRules: [] },
      },
    });
    const workflow = {
      id: "wf-1",
      activeStageId: "scenarioReview",
      reviewWorkspace: {
        workspaceRevision: 0,
        scenarios: [item("a1", "accepted"), item("a2", "accepted"), item("p1", "pending"), item("p2", "pending"), item("p3", "pending")],
        summary: { total: 5, pending: 3, accepted: 2, rejected: 0, requiresReview: 0 },
        policy: { originsRequiringReview: ["AI", "USER"] },
      },
    } as unknown as TestGenerationWorkflow;
    render(<ScenarioReviewStage workflow={workflow} onAdvanced={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Finalize Review" }));
    const dialog = within(screen.getByTestId("confirm-dialog"));
    expect(dialog.getByText(/3 scenarios have no decision and will be excluded/)).toBeInTheDocument();
    expect(dialog.getByText(/Finalize with the 2 accepted scenarios\?/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Finalize anyway (2)" })).toBeInTheDocument();
  });
});

describe("ScenarioReviewStage while finalizing", () => {
  it("disables every review control until finalize settles", async () => {
    const request = { pathParameters: {}, queryParameters: {}, headers: {} };
    const workflow = {
      id: "wf-1",
      activeStageId: "scenarioReview",
      reviewWorkspace: {
        workspaceRevision: 0,
        scenarios: [
          {
            scenarioId: "a1",
            revision: 0,
            state: "accepted",
            isUserModified: false,
            history: [],
            scenario: {
              id: "a1",
              operationPath: "/health",
              operationMethod: "GET",
              category: "positive",
              request,
              displayRequest: request,
              assertions: [],
              provenance: { source: "RULE", rule: "positive", description: "a1", duplicateOfRules: [] },
            },
          },
        ],
        summary: { total: 1, pending: 0, accepted: 1, rejected: 0, requiresReview: 0 },
        policy: { originsRequiringReview: ["AI", "USER"] },
      },
    } as unknown as TestGenerationWorkflow;
    let settle: (value: Awaited<ReturnType<typeof client.finalizeScenarioReview>>) => void = () => {};
    const finalizeSpy = vi
      .spyOn(client, "finalizeScenarioReview")
      .mockReturnValue(new Promise((resolve) => (settle = resolve)));
    render(<ScenarioReviewStage workflow={workflow} onAdvanced={vi.fn()} />);

    const rowCheckbox = screen.getByRole("checkbox", { name: /Select GET \/health/ });
    expect(rowCheckbox).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Finalize Review" }));

    expect(finalizeSpy).toHaveBeenCalled();
    expect(screen.getByText("Review is locked while it is being finalized.")).toBeInTheDocument();
    expect(rowCheckbox).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Select all filtered scenarios" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Accept all filtered (1)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Finalizing…" })).toBeDisabled();

    await act(async () => settle({ ok: false, error: "x", message: "Dependency analysis failed." }));
    expect(rowCheckbox).toBeEnabled();
    vi.restoreAllMocks();
  });
});
