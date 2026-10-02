import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PerformanceJourney, PerformancePlan, UserJourneyDefinition } from "@apipilot/shared-domain";
import { PerformancePlanScreen } from "../../src/components/performance/PerformancePlanScreen";
import { guidedPerformanceClient } from "../../src/services/performanceTestingClient";
import { quickPerformanceClient } from "../../src/services/quickPerformanceClient";
import { environment, quickPlan, quickStep, stubFetch } from "./performanceFixtures";

/** AP-035 User Stories 1 to 3 on the shared plan screen (specs/035-user-defined-journeys research R16; tasks T023, T042, T051). */

const QUICK = "/api/quick-performance";
const GUIDED = "/api/test-generation-workflow/performance";

const create = quickStep("POST", "/orders", {
  id: "s-u-create",
  expectedStatuses: [{ code: "201", source: "specification" }],
  produces: ["order_id"],
  captures: [{ name: "order_id", source: { kind: "body", path: "orderId", segments: [{ field: "orderId" }] }, documented: true }],
  variableBindings: [{ variable: "order_id", role: "produces", field: "orderId" }],
  userDefined: true,
});
const replace = quickStep("PUT", "/orders/{orderId}", {
  id: "s-u-replace",
  consumes: ["order_id"],
  bindings: [{ target: { kind: "path", name: "orderId" }, captureStepId: "s-u-create", captureName: "order_id", state: "active" }],
  variableBindings: [{ variable: "order_id", role: "consumes", field: "orderId", location: "path", producerStepId: "s-u-create" }],
  userDefined: true,
});
const definition: UserJourneyDefinition = {
  id: "j-user",
  name: "Order lifecycle",
  origin: { kind: "defined" },
  nextStepNumber: 3,
  steps: [
    { id: "s-u-create", operationKey: "POST /orders", captures: create.captures!, bindings: [] },
    { id: "s-u-replace", operationKey: "PUT /orders/{orderId}", captures: [], bindings: replace.bindings! },
  ],
};
const userJourney: PerformanceJourney = { id: "j-user", source: { kind: "user", userJourneyId: "j-user", name: "Order lifecycle" }, steps: [create, replace] };

function withJourney(overrides: Partial<PerformancePlan> = {}, journey: PerformanceJourney = userJourney, journeyDefinition = definition): PerformancePlan {
  const base = quickPlan();
  return {
    ...base,
    journeys: [...base.journeys.filter((candidate) => !["POST /orders", "PUT /orders/{orderId}"].includes(candidate.steps[0].operationKey)), journey],
    userJourneys: [journeyDefinition],
    alsoStandalone: [],
    nextUserJourneyNumber: 2,
    bindingsNeedingAttention: [],
    ...overrides,
  };
}

function routes(base: string, plan: PerformancePlan, onPut: (body: unknown) => [number, unknown] = () => [200, { plan, script: null }]) {
  return {
    [`GET ${base}/plan`]: () => [200, { plan, script: null }] as [number, unknown],
    [`PUT ${base}/plan`]: (call: { body: unknown }) => onPut(call.body),
    [`GET ${base}/plan/response-fields`]: () => [200, { fields: [{ path: "orderId", type: "string", statusCodes: ["201"] }, { path: "total", type: "number", statusCodes: ["201"] }], truncated: false }] as [number, unknown],
    [`GET ${base}/plan/steps/s-u-replace/request`]: () =>
      [200, { request: { stepId: "s-u-replace", operationKey: "PUT /orders/{orderId}", method: "PUT", pathTemplate: "/orders/{orderId}", parameters: [{ location: "path", name: "orderId", value: { kind: "generated", text: "x" } }, { location: "query", name: "note", value: { kind: "generated", text: "n" } }], auth: { kind: "none", schemeName: null, location: null, references: [] }, body: null, bodyStatus: "not-documented", bodyEdit: null, parameterEdit: null } }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    [`GET ${base}/plan/values`]: () => [200, { environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://x" }, values: [] }] as [number, unknown],
    [`GET ${base}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${base}/runs`]: () => [200, { runs: [] }] as [number, unknown],
  };
}

function renderScreen(client = quickPerformanceClient) {
  return render(<PerformancePlanScreen client={client} title="Plan" lead="lead" scopeNote={() => null} testId="plan-screen" />);
}

const panel = async () => within(await screen.findByTestId("user-journeys"));
const puts = (calls: { method: string; body: unknown }[]) => calls.filter((call) => call.method === "PUT").map((call) => call.body as Record<string, unknown>);

afterEach(() => vi.unstubAllGlobals());

describe("composing a journey (User Story 1)", () => {
  it("creates a named journey with its first step from the plan's operations (FR-001)", async () => {
    const calls = stubFetch(routes(QUICK, quickPlan()));
    renderScreen();
    fireEvent.click((await panel()).getByRole("button", { name: "New journey" }));
    const dialog = within(screen.getByTestId("add-step-dialog"));
    fireEvent.change(dialog.getByLabelText("Journey name"), { target: { value: "Order lifecycle" } });
    fireEvent.change(dialog.getByLabelText("First step"), { target: { value: "POST /orders" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create journey" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]).toEqual({ userJourneys: [{ name: "Order lifecycle", steps: [{ operationKey: "POST /orders", captures: [], bindings: [] }] }] });
  });

  it("marks the journey as defined by you, and each step's captures and captured values in text (FR-022)", async () => {
    stubFetch(routes(QUICK, withJourney()));
    renderScreen();
    const journeys = await panel();
    expect(journeys.getByRole("heading", { name: "Order lifecycle" })).toBeInTheDocument();
    expect(journeys.getAllByText("Defined by you").length).toBeGreaterThan(0);
    expect(journeys.getByText("← response field orderId")).toBeInTheDocument();
    expect(screen.getAllByText("Uses captured value").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Captures 1").length).toBeGreaterThan(0);
  });

  it("explains a refused move by the capture it would break, and leaves the order unchanged (FR-015)", async () => {
    stubFetch(routes(QUICK, withJourney(), () => [400, { error: "dependency_order_violation", message: "m", variable: "order_id", producerStepId: "s-u-create", consumerStepId: "s-u-replace" }]));
    renderScreen();
    fireEvent.click((await panel()).getByRole("button", { name: "Move step 2 up" }));
    expect(await screen.findByText("That order would run a step before the step that produces order_id. The order is unchanged.")).toBeInTheDocument();
  });

  it("names the capture and the steps that use it when removing its step is refused (FR-015)", async () => {
    stubFetch(routes(QUICK, withJourney(), () => [400, { error: "capture_in_use", message: "m", capture: "order_id", stepIds: ["s-u-replace"] }]));
    renderScreen();
    fireEvent.click((await panel()).getByRole("button", { name: "Remove step 1 from Order lifecycle" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("order_id is used by PUT /orders/{orderId}. Remove those bindings first.");
  });

  it("offers the documented response fields, marking one that matches a later step's parameter (FR-009)", async () => {
    stubFetch(routes(QUICK, withJourney()));
    renderScreen();
    const journeys = await panel();
    fireEvent.click(journeys.getAllByText("Capture or use a value")[0]);
    expect(await journeys.findByText(/Documented fields: orderId \(matches a later step's parameter\), total\./)).toBeInTheDocument();
  });

  it("adds a capture from what the engineer types, sending the whole list", async () => {
    const calls = stubFetch(routes(QUICK, withJourney()));
    renderScreen();
    const journeys = await panel();
    fireEvent.click(journeys.getAllByText("Capture or use a value")[0]);
    const form = within(journeys.getByRole("form", { name: "Add a capture to POST /orders" }));
    fireEvent.change(form.getByLabelText("Capture name"), { target: { value: "total" } });
    fireEvent.change(form.getByLabelText("Field path"), { target: { value: "total" } });
    fireEvent.click(form.getByRole("button", { name: "Add capture" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    const [sent] = puts(calls)[0].userJourneys as { steps: { captures: unknown[] }[] }[];
    expect(sent.steps[0].captures).toEqual([
      { name: "order_id", source: { kind: "body", path: "orderId" } },
      { name: "total", source: { kind: "body", path: "total" } },
    ]);
  });

  it("offers only an earlier step's captures for a later step's parameter (FR-011)", async () => {
    stubFetch(routes(QUICK, withJourney()));
    renderScreen();
    const journeys = await panel();
    fireEvent.click(journeys.getAllByText("Capture or use a value")[1]);
    const form = within(await journeys.findByRole("form", { name: "Fill a value of PUT /orders/{orderId} from an earlier step" }));
    const captures = within(form.getByLabelText("Value captured by an earlier step")).getAllByRole("option");
    expect(captures.map((option) => option.textContent)).toEqual(["order_id (step 1)"]);
    await waitFor(() => expect(within(form.getByLabelText("Target")).getAllByRole("option").map((option) => option.textContent)).toEqual(["path parameter orderId", "query parameter note"]));
  });

  it("asks before deleting a journey, saying its operations return as single-step journeys (FR-004)", async () => {
    const calls = stubFetch(routes(QUICK, withJourney()));
    renderScreen();
    fireEvent.click((await panel()).getByRole("button", { name: "Delete journey Order lifecycle" }));
    const dialog = within(screen.getByTestId("confirm-dialog"));
    expect(dialog.getByText(/return as single-step journeys/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: /Delete journey/ }));
    await waitFor(() => expect(puts(calls)[0]).toEqual({ userJourneys: [] }));
  });

  it("shows an incomplete journey in the panel, in the pending notes and at the run trigger, without blocking the script (FR-025)", async () => {
    const incomplete = { ...userJourney, steps: [create], incompleteReason: { missingOperationKeys: ["PUT /orders/{orderId}"] } };
    stubFetch(routes(QUICK, withJourney({ stepsNeedingExpectedStatus: [] }, incomplete)));
    renderScreen();
    const journeys = await panel();
    expect(journeys.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByText(/1 journey is incomplete and will not run: Order lifecycle \(PUT \/orders\/\{orderId\} not in the plan\)/)).toBeInTheDocument();
    expect(screen.getByTestId("run-trigger-incomplete")).toHaveTextContent("Order lifecycle (incomplete: PUT /orders/{orderId} not in the plan)");
    expect(screen.queryByText("A captured value's target no longer exists")).not.toBeInTheDocument();
  });
});

describe("captured values anywhere (User Story 2)", () => {
  it("asks before a binding drops an edited parameter, and sends the binding with the reduced edits (FR-014)", async () => {
    let attempt = 0;
    const plan = withJourney({ parameterEdits: [{ stepId: "s-u-replace", operationKey: "PUT /orders/{orderId}", scenarioId: "sc", parameters: [{ location: "query", name: "note", action: "set", value: "n1" }] }] });
    const calls = stubFetch(routes(QUICK, plan, () => (attempt++ === 0 ? [400, { error: "parameter_edited", message: "m", stepId: "s-u-replace", name: "note" }] : [200, { plan, script: null }])));
    renderScreen();
    const journeys = await panel();
    fireEvent.click(journeys.getAllByText("Capture or use a value")[1]);
    const form = within(await journeys.findByRole("form", { name: "Fill a value of PUT /orders/{orderId} from an earlier step" }));
    await waitFor(() => expect(within(form.getByLabelText("Target")).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(form.getByLabelText("Target"), { target: { value: "query:note" } });
    fireEvent.click(form.getByRole("button", { name: "Use captured value" }));
    const dialog = within(await screen.findByTestId("confirm-dialog"));
    expect(dialog.getByText(/note has an edited value/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: /Use captured value/ }));
    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    expect(puts(calls)[1].parameterEdits).toEqual({ "s-u-replace": null });
  });

  it("blocks the script while a binding's target no longer exists, and says so (FR-016)", async () => {
    const missing = { ...replace, bindings: [{ ...replace.bindings![0], state: "target-missing" as const }] };
    stubFetch(routes(QUICK, withJourney({ stepsNeedingExpectedStatus: [], bindingsNeedingAttention: ["s-u-replace"] }, { ...userJourney, steps: [create, missing] }, { ...definition, steps: [definition.steps[0], { ...definition.steps[1], bindings: missing.bindings! }] })));
    renderScreen();
    expect(await screen.findByText(/a value whose target no longer exists/)).toBeInTheDocument();
    expect(screen.getAllByText("Target no longer exists").length).toBeGreaterThan(0);
    expect(screen.getByText(/Waiting: a captured value's target no longer exists/)).toBeInTheDocument();
  });
});

describe("proposed workflow journeys (User Story 3)", () => {
  it("offers Edit journey on the guided path only, and confirms a revert naming the added steps (FR-024)", async () => {
    const based: UserJourneyDefinition = {
      ...definition,
      id: "j-based",
      name: "Workflow wf",
      origin: { kind: "based-on-workflow", workflowId: "wf" },
      steps: [{ ...definition.steps[0], fromProposedStepId: "s-create" }, { ...definition.steps[1] }],
    };
    const guidedPlan = withJourney({ source: "guided" }, { ...userJourney, id: "j-based", source: { kind: "user", userJourneyId: "j-based", name: "Workflow wf", basedOnWorkflowId: "wf" } }, based);
    const calls = stubFetch(routes(GUIDED, guidedPlan));
    renderScreen(guidedPerformanceClient);
    const journeys = await panel();
    expect(journeys.getAllByText("Based on workflow").length).toBeGreaterThan(0);
    fireEvent.click(journeys.getByRole("button", { name: "Revert to proposed journey" }));
    const dialog = within(screen.getByTestId("confirm-dialog"));
    expect(dialog.getByText(/The settings of the steps you added are discarded: PUT \/orders\/\{orderId\}\./)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: /Revert/ }));
    await waitFor(() => expect(puts(calls)[0]).toEqual({ revertProposedJourney: "j-based" }));
  });

  it("does not offer Edit journey or Revert on the quick path", async () => {
    stubFetch(routes(QUICK, withJourney()));
    renderScreen();
    const journeys = await panel();
    expect(journeys.queryByRole("button", { name: /Edit the journey proposed/ })).not.toBeInTheDocument();
    expect(journeys.queryByRole("button", { name: "Revert to proposed journey" })).not.toBeInTheDocument();
  });
});

describe("editing a proposed workflow journey (User Story 3)", () => {
  it("offers Edit journey for each proposed workflow journey on the guided path, and sends the conversion (FR-024)", async () => {
    const guidedPlan: PerformancePlan = { ...quickPlan(), source: "guided", journeys: [{ id: "j-wf", source: { kind: "workflow", workflowId: "wf-1" }, steps: [create, replace] }] };
    const calls = stubFetch(routes(GUIDED, guidedPlan));
    renderScreen(guidedPerformanceClient);
    fireEvent.click((await panel()).getByRole("button", { name: "Edit the journey proposed from workflow wf-1" }));
    await waitFor(() => expect(puts(calls)[0]).toEqual({ editProposedJourney: "j-wf" }));
  });
});
