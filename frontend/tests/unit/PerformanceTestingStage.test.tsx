import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PerformanceTestingStage } from "../../src/components/performance/PerformanceTestingStage";
import { environment, planFixture, readyPlan, script, SECRET, stubFetch } from "./performanceFixtures";

/** AP-029 US1 and US4 stage UI (tasks T033, T085). */

const PLAN = "/api/test-generation-workflow/performance/plan";

function baseRoutes(plan = planFixture(), extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  return {
    [`GET ${PLAN}`]: () => [200, { plan, script: null }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment({ variableValues: { clientSecret: SECRET } })] }] as [number, unknown],
    [`GET ${PLAN}/values`]: () =>
      [200, {
        environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
        values: plan.userSuppliedValues.map((value) => ({ ...value, present: value.name !== "warehouseId" })),
      }] as [number, unknown],
    "GET /api/test-generation-workflow/performance/readiness": () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    "GET /api/test-generation-workflow/performance/runs": () => [200, { runs: [] }] as [number, unknown],
    ...extra,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("PerformanceTestingStage", () => {
  it("shows a loading state, then each journey and step with its method, scenario and expected statuses as text", async () => {
    stubFetch(baseRoutes());
    render(<PerformanceTestingStage />);
    expect(screen.getByText("Building the performance plan…")).toBeInTheDocument();
    await screen.findByText("Create order");
    const journey = screen.getByRole("region", { name: "Journey 1: Workflow journey" });
    expect(within(journey).getAllByTestId("http-method-badge").map((badge) => badge.textContent)).toEqual(["POST", "GET"]);
    expect(within(journey).getByText("CONFIRMED dependency")).toBeInTheDocument();
    expect(within(journey).getByText("Rule-generated")).toBeInTheDocument();
    expect(within(journey).getAllByText("· from specification").length).toBeGreaterThan(0);
  });

  it("explains the expected-status input and adds no choice note for an operation's only positive scenario", async () => {
    stubFetch(baseRoutes());
    render(<PerformanceTestingStage />);
    await screen.findByText("Service status");
    const row = screen.getByText("Service status").closest("td")!;
    expect(row.children).toHaveLength(1);
    expect(screen.getByLabelText("Add an expected status for GET /status")).toHaveAccessibleDescription(
      "Expected status: a response with any other status counts as a failure. Add an exact code such as 201, or a range such as 2XX for any 2xx.",
    );
  });

  it("lists the step that needs an expected status and keeps Generate disabled with the reason (FR-012a)", async () => {
    stubFetch(baseRoutes());
    render(<PerformanceTestingStage />);
    await screen.findByText("Service status");
    expect(screen.getByText("The specification documents no success status. Set at least one.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 step needs an expected status before the script can be generated: GET /status.");
    expect(screen.getByRole("button", { name: "Generate script" })).toBeDisabled();
  });

  it("sends a new expected status and enables Generate once none is missing", async () => {
    const calls = stubFetch(
      baseRoutes(planFixture(), {
        [`PUT ${PLAN}`]: () => [200, { plan: readyPlan(), script: null }],
      }),
    );
    render(<PerformanceTestingStage />);
    await screen.findByText("Service status");
    fireEvent.change(screen.getByLabelText("Add an expected status for GET /status"), { target: { value: "200" } });
    fireEvent.click(within(screen.getByRole("region", { name: "Journey 2: Single operation" })).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate script" })).toBeEnabled());
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ expectedStatuses: { "s-status": ["200"] } });
    expect(screen.getByText("· set by you")).toBeInTheDocument();
  });

  it("removes an operation by sending excludedOperationKeys (FR-004)", async () => {
    const calls = stubFetch(baseRoutes(planFixture(), { [`PUT ${PLAN}`]: () => [200, { plan: planFixture(), script: null }] }));
    render(<PerformanceTestingStage />);
    await screen.findByText("Get warehouse");
    const row = screen.getByText("Get warehouse").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ excludedOperationKeys: ["GET /warehouses/{warehouseId}"] });
  });

  it("shows the load profile's stages as editable numbers, and no thresholds until one is added (FR-017, FR-018)", async () => {
    stubFetch(baseRoutes());
    render(<PerformanceTestingStage />);
    await screen.findByText("Create order");
    fireEvent.change(screen.getByLabelText("Profile"), { target: { value: "load" } });
    expect(screen.getByLabelText("Stage 1 duration in seconds")).toHaveValue(120);
    expect(screen.getByLabelText("Stage 1 target virtual users")).toHaveValue(10);
    expect(screen.getByLabelText("Stage 3 target virtual users")).toHaveValue(0);
    expect(screen.getByText("No thresholds set. The report will show measurements with no pass/fail verdict.")).toBeInTheDocument();
  });

  it("shows each needed value with who needs it, secret, and present or missing as text, never a value (FR-013)", async () => {
    stubFetch(baseRoutes());
    render(<PerformanceTestingStage />);
    const table = await screen.findByRole("table", { name: "Values the plan needs from the environment" });
    const warehouse = within(table).getByText("warehouseId").closest("tr")!;
    expect(warehouse).toHaveTextContent("Missing");
    expect(warehouse).toHaveTextContent("GET /warehouses/{warehouseId}");
    expect(within(within(table).getByText("clientSecret").closest("tr")!).getByText("secret")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("offers the downloads for a current script, and says when it is out of date (FR-022, FR-023)", async () => {
    stubFetch({ ...baseRoutes(readyPlan()), [`GET ${PLAN}`]: () => [200, { plan: readyPlan(), script: script() }] });
    const { unmount } = render(<PerformanceTestingStage />);
    expect(await screen.findByRole("link", { name: "Download script" })).toHaveAttribute("href", `${PLAN.replace("/plan", "")}/script/download?file=script`);
    expect(screen.getByRole("link", { name: "Download environment template" })).toBeInTheDocument();
    unmount();

    stubFetch({ ...baseRoutes(readyPlan()), [`GET ${PLAN}`]: () => [200, { plan: readyPlan(), script: script({ outOfDate: true }) }] });
    render(<PerformanceTestingStage />);
    expect(await screen.findByText("Out of date — regenerate")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download script" })).not.toBeInTheDocument();
  });

  it("shows an error state, not an empty plan, when the plan cannot be loaded", async () => {
    stubFetch({ ...baseRoutes(), [`GET ${PLAN}`]: () => [409, { error: "postman_generation_incomplete", message: "Performance testing opens once the Postman collection has been generated." }] });
    render(<PerformanceTestingStage />);
    expect(await screen.findByTestId("performance-plan-error")).toHaveTextContent("Performance testing opens once the Postman collection has been generated.");
  });

  it("sends reorders and shows a dependency rejection naming the variable, leaving the order unchanged (FR-007, US4)", async () => {
    const calls = stubFetch(
      baseRoutes(planFixture(), {
        [`PUT ${PLAN}`]: (call) =>
          (call.body as { stepOrder?: unknown }).stepOrder
            ? [400, { error: "dependency_order_violation", message: "no", variable: "orderId" }]
            : [200, { plan: planFixture(), script: null }],
      }),
    );
    render(<PerformanceTestingStage />);
    await screen.findByText("Get order");
    fireEvent.click(screen.getByRole("button", { name: "Move GET /orders/{orderId} up" }));
    expect(await screen.findByTestId("performance-plan-problem")).toHaveTextContent("That order would run a step before the step that produces orderId. The order is unchanged.");
    expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ stepOrder: { j1: ["s-read", "s-create"] } });
    const rows = within(screen.getByRole("region", { name: "Journey 1: Workflow journey" })).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Create order");

    fireEvent.click(screen.getByRole("button", { name: "Move journey 2 down" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2));
    expect(calls.filter((call) => call.method === "PUT")[1].body).toEqual({ journeyOrder: ["j1", "j3", "j2"] });
  });

  it("sends the think time in milliseconds (FR-008, US4)", async () => {
    const calls = stubFetch(baseRoutes(planFixture(), { [`PUT ${PLAN}`]: () => [200, { plan: planFixture({ thinkTimeMs: 2000 }), script: null }] }));
    render(<PerformanceTestingStage />);
    await screen.findByText("Create order");
    const input = screen.getByLabelText("Think time between steps in seconds");
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);
    await waitFor(() => expect(calls.find((call) => call.method === "PUT")?.body).toEqual({ thinkTimeMs: 2000 }));
  });

  it("re-checks the values when another environment is chosen (FR-013)", async () => {
    const calls = stubFetch({
      ...baseRoutes(),
      "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment(), environment({ id: "env-2", name: "staging", tier: "staging" })] }],
    });
    render(<PerformanceTestingStage />);
    await screen.findByText("Create order");
    fireEvent.change(screen.getByLabelText("Target environment"), { target: { value: "env-2" } });
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("environmentId=env-2"))).toBe(true));
  });
});
