import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PerformancePage } from "../../src/pages/PerformancePage";
import { quickTestView, stubFetch, type Call } from "./performanceFixtures";
import { baseRoutes, NO_QUICK_TEST, PLAN, planSummary, QUICK, seededPlan, viewWithScript as withScript } from "./performancePathFixtures";
import { PLAN_ID, viewOf } from "./requestChainFixtures";

/** AP-047 (specs/047-unified-performance-tab): the five-step path from the entry screen to the Run step. */

const calls = (all: Call[], method: string, suffix: string) => all.filter((call) => call.method === method && call.url.split("?")[0].endsWith(suffix));
const next = () => screen.getByRole("button", { name: "Next →" });
const current = () => screen.getAllByRole("listitem").find((item) => item.getAttribute("aria-current") === "step");

afterEach(() => vi.unstubAllGlobals());

describe("PerformancePath: a specification to the Run step (US1)", () => {
  it("opens on Operations with the uploaded specification, creates the plan from the chosen operations and reaches Run in one tab", async () => {
    const plan = seededPlan({ targetEnvironmentId: "env-1" });
    const all = stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
        "GET /api/chain-plans": () => [200, { plans: [] }],
        "POST /api/chain-plans/seed": () => [201, { ...withScript(plan), movedCredentials: [] }],
        [`GET ${PLAN}`]: () => [200, withScript(plan, ["baseUrl"])],
        [`POST ${PLAN}/runs`]: () => [404, { error: "not_found", message: "stub" }],
      }),
    );
    render(<PerformancePage />);

    // Home: no plans, so the picker with its introduction and no table.
    expect(await screen.findByRole("heading", { name: "Turn what you have into a load test" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Saved performance plans" })).not.toBeInTheDocument();
    await waitFor(() => expect(calls(all, "GET", QUICK)).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /OpenAPI specification/ }));

    // Operations: the uploaded specification is reused, so the path opens here with Source still reachable.
    expect(await screen.findByRole("heading", { name: "Choose the operations to include" })).toBeInTheDocument();
    expect(current()).toHaveTextContent("Operations");
    expect(screen.getByTestId("performance-step-source")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("performance-step-plan")).toHaveAttribute("aria-disabled", "true");
    const selection = screen.getByTestId("operation-selection");
    expect(within(selection).getByText("3 of 3 selected")).toBeInTheDocument();
    fireEvent.click(within(selection).getByRole("checkbox", { name: "DELETE /customers/{id}" }));
    expect(within(selection).getByText("2 of 3 selected")).toBeInTheDocument();
    fireEvent.click(next());

    // The plan is created from the chosen operations only, in specification order, and opens on Plan.
    await screen.findByLabelText("Plan name");
    expect(calls(all, "POST", "/seed")).toHaveLength(1);
    expect(calls(all, "POST", "/seed")[0].body).toMatchObject({ name: "Quick Performance Fixture", source: { kind: "specification", selectedOperationKeys: ["GET /customers", "POST /customers"] } });
    expect(current()).toHaveTextContent("Plan");
    expect(screen.getByTestId("path-title")).toHaveTextContent("Quick Performance Fixture");
    expect(screen.getByText("Seeded from quick-performance.yaml")).toBeInTheDocument();
    expect(screen.getByLabelText("Plan name")).toHaveValue("Quick Performance Fixture");

    // Load: the plan's own configuration. Run: the launch card names the target and lists the write.
    fireEvent.click(next());
    expect(await screen.findByRole("heading", { name: "Configuration" })).toBeInTheDocument();
    fireEvent.click(next());
    const card = await screen.findByTestId("run-launch-card");
    expect(current()).toHaveTextContent("Run");
    expect(screen.queryByRole("button", { name: "Next →" })).not.toBeInTheDocument();
    await waitFor(() => expect(card).toHaveTextContent("Ready to run on perf-local (local)"));
    expect(card).toHaveTextContent("POST");
    expect(card).toHaveTextContent("/customers");

    // Nothing was sent to any system on the way (constitution XVII), and no extra confirmation stands in front of Start.
    expect(calls(all, "POST", "/runs")).toHaveLength(0);
    const start = within(card).getByRole("button", { name: /Start run on perf-local/ });
    expect(start).toBeEnabled();
    fireEvent.click(start);
    await waitFor(() => expect(calls(all, "POST", "/runs")).toHaveLength(1));
  });

  it("opens on Source with no upload, keeps Next locked until the specification is analysed, then carries it forward", async () => {
    let uploaded = false;
    stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => (uploaded ? [200, { quickTest: quickTestView() }] : NO_QUICK_TEST),
        [`POST ${QUICK}`]: () => {
          uploaded = true;
          return [200, { quickTest: quickTestView() }];
        },
        "GET /api/chain-plans": () => [200, { plans: [] }],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
    expect(current()).toHaveTextContent("Source");
    expect(next()).toBeDisabled();
    expect(screen.getByText("Upload the specification to continue")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Upload OpenAPI specification"), { target: { files: [new File(["openapi: 3.0.3"], "quick-performance.yaml")] } });
    expect(await screen.findByTestId("uploaded-specification")).toHaveTextContent("quick-performance.yaml");
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    expect(await screen.findByRole("heading", { name: "Choose the operations to include" })).toBeInTheDocument();
    // Every operation of the analysed specification starts selected.
    expect(within(screen.getByTestId("operation-selection")).getByText("3 of 3 selected")).toBeInTheDocument();
  });

  it("has Plans in the top row, no exit control (AP-054), and the reason Next is unavailable beside Next (specs/050 FR-004, FR-005)", async () => {
    stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => NO_QUICK_TEST, "GET /api/chain-plans": () => [200, { plans: [] }] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
    expect(screen.getByTestId("path-title")).toHaveTextContent("New performance test");
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Plans" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to start|Exit performance testing/ })).not.toBeInTheDocument();
    const reason = screen.getByRole("status");
    expect(reason).toHaveTextContent("Upload the specification to continue");
    expect(next()).toBeDisabled();
    expect(reason.parentElement).toContainElement(next());
  });

  it("keeps the selection when the engineer goes Back and forward again, and locks Next with the reason when nothing is chosen", async () => {
    stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }], "GET /api/chain-plans": () => [200, { plans: [] }] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
    const selection = await screen.findByTestId("operation-selection");
    fireEvent.click(within(selection).getByRole("checkbox", { name: "GET /customers" }));
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(current()).toHaveTextContent("Source");
    fireEvent.click(next());
    expect(within(await screen.findByTestId("operation-selection")).getByText("2 of 3 selected")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("operation-selection")).getByRole("checkbox", { name: /Select all/ }));
    fireEvent.click(within(screen.getByTestId("operation-selection")).getByRole("checkbox", { name: /Select all/ }));
    expect(next()).toBeDisabled();
    expect(screen.getByText("Choose at least one operation")).toBeInTheDocument();
  });

  it("shows the server's refusal and stays on Operations without creating a plan", async () => {
    stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
        "GET /api/chain-plans": () => [200, { plans: [] }],
        "POST /api/chain-plans/seed": () => [409, { error: "quick_test_not_found", message: "Upload a specification in Performance first." }],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
    await screen.findByTestId("operation-selection");
    fireEvent.click(next());
    expect(await screen.findByText("Upload a specification in Performance first.")).toBeInTheDocument();
    expect(current()).toHaveTextContent("Operations");
  });
});

describe("PerformancePath: an opened plan (US2)", () => {
  const summary = planSummary;

  it("lands on Plan with every step selectable and the source read-only, and reaches Run in one more interaction", async () => {
    const plan = seededPlan({ targetEnvironmentId: "env-1" });
    stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
        "GET /api/chain-plans": () => [200, { plans: [summary] }],
        [`GET ${PLAN}`]: () => [200, withScript(plan, ["baseUrl"])],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Quick Performance Fixture" }));
    await screen.findByLabelText("Plan name");
    expect(current()).toHaveTextContent("Plan");
    for (const step of ["source", "operations", "plan", "load", "run"]) expect(screen.getByTestId(`performance-step-${step}`)).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText("Seeded from quick-performance.yaml")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("performance-step-source"));
    expect(await screen.findByText(/This plan was seeded from quick-performance.yaml/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Guided workflow/ })).toBeDisabled();

    fireEvent.click(screen.getByTestId("performance-step-run"));
    expect(await screen.findByTestId("run-launch-card")).toBeInTheDocument();
    expect(current()).toHaveTextContent("Run");
  });

  it("opens the plan another view asked for, again each time it asks, whatever step the path was on", async () => {
    const plan = seededPlan();
    stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }], "GET /api/chain-plans": () => [200, { plans: [summary] }], [`GET ${PLAN}`]: () => [200, viewOf(plan)] }));
    const { rerender } = render(<PerformancePage openRequest={{ planId: PLAN_ID, nonce: 1 }} />);
    await screen.findByLabelText("Plan name");
    expect(current()).toHaveTextContent("Plan");
    fireEvent.click(screen.getByTestId("performance-step-source"));
    expect(current()).toHaveTextContent("Source");
    rerender(<PerformancePage openRequest={{ planId: PLAN_ID, nonce: 2 }} />);
    await waitFor(() => expect(current()).toHaveTextContent("Plan"));
  });

  it("opens a plan on the Run step when the request names one of its runs (AP-054, Home's Recent runs)", async () => {
    const plan = seededPlan();
    stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }], "GET /api/chain-plans": () => [200, { plans: [summary] }], [`GET ${PLAN}`]: () => [200, viewOf(plan)] }));
    render(<PerformancePage openRequest={{ planId: PLAN_ID, nonce: 1, runId: "run-1" }} />);
    await waitFor(() => expect(current()).toHaveTextContent("Run"));
    expect(screen.getByTestId("performance-step-run").closest("li")).toHaveAttribute("aria-current", "step");
  });

  it("goes back to the entry screen without creating a draft, and lists the plan again", async () => {
    const plan = seededPlan();
    stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
        "GET /api/chain-plans": () => [200, { plans: [summary] }],
        [`GET ${PLAN}`]: () => [200, viewOf(plan)],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Quick Performance Fixture" }));
    await screen.findByLabelText("Plan name");
    fireEvent.click(screen.getByRole("button", { name: "← Plans" }));
    expect(await screen.findByRole("table", { name: "Saved performance plans" })).toBeInTheDocument();
    expect(screen.queryByText(/Draft in progress/)).not.toBeInTheDocument();
  });

  it("shows the operations of a plan seeded from another specification as a read-only summary, with the reason", async () => {
    const plan = seededPlan({ seedingReport: { source: { kind: "specification", filename: "old-spec.yaml" }, seededAt: "t", items: [] } });
    stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
        "GET /api/chain-plans": () => [200, { plans: [summary] }],
        [`GET ${PLAN}`]: () => [200, viewOf(plan)],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Quick Performance Fixture" }));
    await screen.findByLabelText("Plan name");
    fireEvent.click(screen.getByTestId("performance-step-operations"));
    const summaryText = await screen.findByTestId("operations-step-readonly");
    expect(summaryText).toHaveTextContent("seeded from old-spec.yaml with 2 items");
    expect(summaryText).toHaveTextContent("the uploaded specification is now quick-performance.yaml");
    expect(screen.queryByTestId("operation-selection")).not.toBeInTheDocument();
    // Nothing to choose here, so Next is not held back.
    expect(screen.getByRole("button", { name: "Next →" })).toBeEnabled();
  });
});
