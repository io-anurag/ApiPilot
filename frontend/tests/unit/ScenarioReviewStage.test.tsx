import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { ScenarioReviewStage } from "../../src/components/ScenarioReviewStage";

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
