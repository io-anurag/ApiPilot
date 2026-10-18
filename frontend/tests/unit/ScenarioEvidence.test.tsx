import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GeneratedRequest, TestScenario } from "@apipilot/shared-domain";
import type { ReviewScenarioWire } from "../../src/services/reviewsClient";
import { GenerationNotes } from "../../src/components/ScenarioEvidence";
import { TestScenarioDetail } from "../../src/components/TestScenarioDetail";
import { TestScenarioReviewDetail } from "../../src/components/TestScenarioReviewDetail";

/** specs/056 FR-035, FR-036, FR-040, FR-043: what a scenario rests on, and operations with no scenarios. */

const observed: TestScenario = {
  id: "1",
  operationPath: "/v1/orders",
  operationMethod: "POST",
  category: "positive",
  request: { pathParameters: {}, queryParameters: {}, headers: {}, body: { sku: "A" } },
  assertions: [{ type: "status-code", expectedStatusCode: "201", basis: "observed" }],
  provenance: { source: "RULE", rule: "observed-example", description: "Replays an observed request.", duplicateOfRules: [] },
  evidence: {
    origin: "observed",
    observationCount: 5,
    derivation: "observed-example",
    summary: "The capture shows this request answered with 201 five times.",
  },
};

describe("scenario evidence in TestScenarioDetail", () => {
  it("shows the origin, the observation count and the stated fact as text", () => {
    render(<TestScenarioDetail scenario={observed} />);
    const evidence = screen.getByTestId("scenario-evidence");
    expect(evidence).toHaveTextContent("Observed ×5");
    expect(screen.getByTestId("scenario-derivation")).toHaveTextContent("Observed example");
    expect(evidence).toHaveTextContent("answered with 201 five times");
  });

  it("labels an asserted status with its basis", () => {
    render(<TestScenarioDetail scenario={observed} />);
    const assertion = screen.getByText(/Status code: 201/).closest("li");
    expect(assertion).toHaveTextContent("Observed");
  });

  it("marks an inference-derived scenario as such", () => {
    render(
      <TestScenarioDetail
        scenario={{ ...observed, evidence: { origin: "inferred", observationCount: 3, derivation: "inference-derived", summary: "Derived from the observed field type." } }}
      />,
    );
    expect(screen.getByTestId("scenario-derivation")).toHaveTextContent("Inference-derived");
    expect(screen.getByTestId("scenario-evidence")).toHaveTextContent("Inferred ×3");
  });

  it("says nothing is asserted, without claiming a documented response, when evidence exists but assertions do not", () => {
    render(<TestScenarioDetail scenario={{ ...observed, assertions: [] }} />);
    expect(screen.getByText(/nothing in the input supports an expected outcome/)).toBeInTheDocument();
    expect(screen.queryByText(/No documented response was available/)).not.toBeInTheDocument();
  });

  it("renders nothing extra for an OpenAPI scenario", () => {
    const { evidence: _evidence, ...documented } = observed;
    void _evidence;
    render(<TestScenarioDetail scenario={{ ...documented, assertions: [{ type: "status-code", expectedStatusCode: "201" }] }} />);
    expect(screen.queryByTestId("scenario-evidence")).not.toBeInTheDocument();
    expect(screen.getByText(/Status code: 201/).closest("li")).not.toHaveTextContent("Observed");
    expect(screen.queryByTestId("fact-origin-badge")).not.toBeInTheDocument();
  });

  it("renders nothing extra for a documented assertion basis", () => {
    const { evidence: _evidence, ...documented } = observed;
    void _evidence;
    render(<TestScenarioDetail scenario={{ ...documented, assertions: [{ type: "status-code", expectedStatusCode: "201", basis: "documented" }] }} />);
    expect(screen.queryByTestId("fact-origin-badge")).not.toBeInTheDocument();
  });
});

describe("scenario evidence in TestScenarioReviewDetail", () => {
  const displayRequest: GeneratedRequest = observed.request;
  const item = (scenario: TestScenario): ReviewScenarioWire => ({
    scenarioId: scenario.id,
    revision: 0,
    state: "pending",
    isUserModified: false,
    history: [],
    scenario: { ...scenario, displayRequest },
  });

  it("shows the evidence and the assertion basis in the review panel", () => {
    render(<TestScenarioReviewDetail item={item(observed)} />);
    expect(screen.getByTestId("scenario-evidence")).toHaveTextContent("Observed ×5");
    expect(screen.getByText(/Status code: 201/).closest("li")).toHaveTextContent("Observed");
  });

  it("states that nothing is asserted rather than claiming a documented response is missing", () => {
    render(<TestScenarioReviewDetail item={item({ ...observed, assertions: [] })} />);
    expect(screen.getByText(/nothing in the input supports an expected outcome/)).toBeInTheDocument();
  });

  it("renders no evidence block for an OpenAPI scenario", () => {
    const { evidence: _evidence, ...documented } = observed;
    void _evidence;
    render(<TestScenarioReviewDetail item={item({ ...documented, assertions: [{ type: "status-code", expectedStatusCode: "201" }] })} />);
    expect(screen.queryByTestId("scenario-evidence")).not.toBeInTheDocument();
  });
});

describe("GenerationNotes (FR-040)", () => {
  it("renders nothing when every operation produced a scenario", () => {
    const { container } = render(<GenerationNotes notes={[]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: absent } = render(<GenerationNotes notes={undefined} />);
    expect(absent).toBeEmptyDOMElement();
  });

  it("lists each operation without scenarios with its reason", () => {
    render(
      <GenerationNotes
        notes={[
          { operationMethod: "GET", operationPath: "/v1/health", reason: "Observed once, below the evidence threshold of 3." },
          { operationMethod: "DELETE", operationPath: "/v1/orders/{orderId}", reason: "Only one response was captured." },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "2 operations have no generated scenarios" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("GET /v1/health: Observed once, below the evidence threshold of 3.");
    expect(items[1]).toHaveTextContent("DELETE /v1/orders/{orderId}");
  });

  it("uses the singular for one operation", () => {
    render(<GenerationNotes notes={[{ operationMethod: "GET", operationPath: "/v1/a", reason: "r" }]} />);
    expect(screen.getByRole("heading", { name: "1 operation has no generated scenarios" })).toBeInTheDocument();
  });
});
