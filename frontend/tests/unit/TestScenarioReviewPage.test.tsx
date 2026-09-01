import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ApiModel, TestModel } from "@apipilot/shared-domain";
import { TestScenarioReviewPage } from "../../src/pages/TestScenarioReviewPage";

const apiModel: ApiModel = {
  operations: [],
  securitySchemes: {},
  summary: { operationCount: 0, schemaCount: 0, securitySchemeCount: 0, issues: [] },
};

const testModel: TestModel = {
  scenarios: [
    {
      id: "s1",
      operationPath: "/widgets",
      operationMethod: "POST",
      category: "positive",
      request: { pathParameters: {}, queryParameters: {}, headers: {}, body: {} },
      assertions: [{ type: "status-code", expectedStatusCode: "201" }],
      provenance: {
        source: "RULE",
        rule: "positive-request",
        description: "d",
        duplicateOfRules: [],
      },
    },
  ],
};

function stubReviewResponse(overrides: Partial<{ scenarios: unknown[] }> = {}) {
  const scenarios =
    overrides.scenarios ??
    testModel.scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      revision: 0,
      state: "pending",
      isUserModified: false,
      history: [],
      scenario: { ...scenario, displayRequest: scenario.request },
    }));
  return {
    review: {
      workspaceRevision: 0,
      scenarios,
      summary: {
        total: scenarios.length,
        pending: scenarios.length,
        accepted: 0,
        rejected: 0,
        requiresReview: 0,
      },
      policy: { originsRequiringReview: ["AI", "USER"] },
    },
    approvedTestModel: { scenarios: [] },
    outcomes: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TestScenarioReviewPage", () => {
  it("shows a loading state, then the scenario list and summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => stubReviewResponse() }),
    );

    render(<TestScenarioReviewPage apiModel={apiModel} testModel={testModel} />);

    expect(screen.getByTestId("review-loading")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByTestId("test-scenario-review-page")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("review-summary-total")).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /POST \/widgets/ })).toBeInTheDocument();
  });

  it("shows an empty state when there are no scenarios to review", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          json: async () => stubReviewResponse({ scenarios: [] }),
        }),
    );

    render(<TestScenarioReviewPage apiModel={apiModel} testModel={{ scenarios: [] }} />);

    await waitFor(() => expect(screen.getByTestId("review-empty")).toBeInTheDocument());
  });

  it("shows an error state when the workspace fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_test_scenario_review_request",
          message: "Bad request",
        }),
      }),
    );

    render(<TestScenarioReviewPage apiModel={apiModel} testModel={testModel} />);

    await waitFor(() =>
      expect(screen.getByTestId("review-load-error")).toHaveTextContent("Bad request"),
    );
  });

  it("selects a scenario and shows its detail and decision controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => stubReviewResponse() }),
    );

    render(<TestScenarioReviewPage apiModel={apiModel} testModel={testModel} />);

    await waitFor(() =>
      expect(screen.getByTestId("test-scenario-review-page")).toBeInTheDocument(),
    );
    screen.getByRole("button", { name: /POST \/widgets/ }).click();

    expect(await screen.findByTestId("review-scenario-detail")).toBeInTheDocument();
    expect(screen.getByTestId("review-scenario-decision")).toBeInTheDocument();
  });
});
