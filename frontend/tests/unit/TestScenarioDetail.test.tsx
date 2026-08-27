import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TestScenario } from "@apipilot/shared-domain";
import { TestScenarioDetail } from "../../src/components/TestScenarioDetail";

const scenario: TestScenario = {
  id: "1",
  operationPath: "/widgets/{widgetId}",
  operationMethod: "PATCH",
  category: "invalid-type",
  targetLocation: "body",
  targetField: "name",
  request: { pathParameters: { widgetId: "abc" }, queryParameters: {}, headers: {}, body: { name: 12345 } },
  assertions: [
    { type: "status-code", expectedStatusCode: "400" },
  ],
  provenance: {
    source: "RULE",
    rule: "invalid-type",
    description: "body field \"name\" set to a value of an incompatible type.",
    duplicateOfRules: [],
  },
};

describe("TestScenarioDetail", () => {
  it("renders the scenario's category, rule, generated request, and expected assertions", () => {
    render(<TestScenarioDetail scenario={scenario} />);

    expect(screen.getByTestId("test-scenario-detail")).toBeInTheDocument();
    expect(screen.getByText("invalid-type — name")).toBeInTheDocument();
    expect(screen.getByTestId("scenario-rule")).toHaveTextContent("invalid-type");
    expect(screen.getByText(/incompatible type/)).toBeInTheDocument();
    expect(screen.getByText(/"name": 12345/)).toBeInTheDocument();
    expect(screen.getByText("Status code: 400")).toBeInTheDocument();
  });

  it("shows a gap message when no assertions are available", () => {
    const gapScenario: TestScenario = { ...scenario, assertions: [] };
    render(<TestScenarioDetail scenario={gapScenario} />);

    expect(screen.getByText(/No documented response was available/)).toBeInTheDocument();
  });
});
