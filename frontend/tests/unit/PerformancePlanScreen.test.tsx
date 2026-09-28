import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PerformancePlan } from "@apipilot/shared-domain";
import { PerformancePlanScreen } from "../../src/components/performance/PerformancePlanScreen";
import { quickPerformanceClient } from "../../src/services/quickPerformanceClient";
import { environment, quickPlan, quickStep, runFixture, script, stubFetch } from "./performanceFixtures";

/** AP-032 US2 and US5 on the shared plan screen (specs/032-quick-performance-test tasks T042, T068). */

const QUICK = "/api/quick-performance";

function routes(plan: PerformancePlan, onPut?: (body: unknown) => PerformancePlan) {
  return {
    [`GET ${QUICK}/plan`]: () => [200, { plan, script: null }] as [number, unknown],
    [`PUT ${QUICK}/plan`]: (call: { body: unknown }) => [200, { plan: onPut ? onPut(call.body) : plan, script: null }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    [`GET ${QUICK}/plan/values`]: () => [200, { environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://x" }, values: [] }] as [number, unknown],
    [`GET ${QUICK}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${QUICK}/runs`]: () => [200, { runs: [] }] as [number, unknown],
  };
}

function renderScreen() {
  return render(<PerformancePlanScreen client={quickPerformanceClient} title="Quick performance test" lead="lead" scopeNote={() => null} testId="plan-screen" />);
}

function withoutKeys(plan: PerformancePlan, keys: readonly string[]): PerformancePlan {
  return {
    ...plan,
    journeys: plan.journeys.filter((journey) => !journey.steps.some((step) => keys.includes(step.operationKey))),
    excludedOperationKeys: [...plan.excludedOperationKeys, ...keys],
  };
}

const detailsButton = (operationKey: string) => screen.getByRole("button", { name: `Details of ${operationKey}` });
const rowOf = (operationKey: string) => detailsButton(operationKey).closest("tr")!;
const puts = (calls: { method: string }[]) => calls.filter((call) => call.method === "PUT");

afterEach(() => vi.unstubAllGlobals());

describe("PerformancePlanScreen write visibility (US2)", () => {
  it("marks each write step with its effect in text beside its method badge (FR-010)", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    expect(rowOf("POST /orders")).toHaveTextContent("Creates");
    expect(rowOf("PUT /orders/{orderId}")).toHaveTextContent("Replaces");
    expect(rowOf("PATCH /orders/{orderId}")).toHaveTextContent("Updates");
    expect(rowOf("DELETE /orders/{orderId}")).toHaveTextContent("Deletes");
    expect(rowOf("GET /orders")).not.toHaveTextContent(/Creates|Replaces|Updates|Deletes/);
  });

  it("shows the write summary above the journeys and next to the run trigger", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    expect(await screen.findByTestId("write-summary-plan")).toHaveTextContent("5 write operations will be sent");
    expect(await screen.findByTestId("write-summary-trigger")).toHaveTextContent("5 write operations will be sent");
  });

  it("removes every DELETE operation in one action, and then every write operation in one action (FR-014, SC-003)", async () => {
    const plan = quickPlan();
    const calls = stubFetch(
      routes(plan, (body) => {
        const excluded = (body as { excludedOperationKeys: string[] }).excludedOperationKeys;
        return withoutKeys(plan, excluded.filter((key) => !plan.excludedOperationKeys.includes(key)));
      }),
    );
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });

    fireEvent.click(screen.getByRole("button", { name: "Remove by method" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove all DELETE operations" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0].body).toEqual({
      excludedOperationKeys: ["POST /auth/login", "DELETE /orders/{orderId}", "DELETE /products/{productId}"],
    });
    expect(await screen.findByTestId("write-summary-plan")).toHaveTextContent("3 write operations will be sent");
    expect(screen.getByTestId("performance-removed-list")).toHaveTextContent("/products/{productId}");

    fireEvent.click(screen.getByRole("button", { name: "Remove all write operations" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(2));
    const second = puts(calls)[1].body as { excludedOperationKeys: string[] };
    expect(second.excludedOperationKeys).toEqual(expect.arrayContaining(["POST /orders", "PUT /orders/{orderId}", "PATCH /orders/{orderId}"]));
    expect(await screen.findByTestId("write-summary-plan")).toHaveTextContent("This plan sends only read requests.");
  });

  it("removes every operation of a read method in one action too (FR-014 covers every method present)", async () => {
    const calls = stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    const toggle = screen.getByRole("button", { name: "Remove by method" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Remove all GET operations" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0].body).toEqual({ excludedOperationKeys: ["POST /auth/login", "GET /orders", "GET /status"] });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("PerformancePlanScreen operations table", () => {
  it("filters to write operations by chip, and removes the ticked operations in one update", async () => {
    const calls = stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    const filters = screen.getByRole("group", { name: "Filter operations by method" });

    fireEvent.click(within(filters).getByRole("button", { name: "Writes 5" }));
    const table = screen.getByRole("table", { name: "Performance plan operations" });
    expect(within(table).queryByRole("button", { name: "Details of GET /orders" })).not.toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: /^Details of / })).toHaveLength(5);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select POST /orders" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select PUT /orders/{orderId}" }));
    const selection = screen.getByRole("region", { name: "Selected operations" });
    expect(selection).toHaveTextContent("2 operations selected");
    fireEvent.click(within(selection).getByRole("button", { name: "Remove from plan" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0].body).toEqual({ excludedOperationKeys: ["POST /auth/login", "POST /orders", "PUT /orders/{orderId}"] });
    expect(screen.queryByRole("region", { name: "Selected operations" })).not.toBeInTheDocument();
  });

  it("shows only the steps needing an expected status when that filter is on (FR-024)", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    const filter = screen.getByRole("button", { name: "Needs expected status · 1" });
    fireEvent.click(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "Performance plan operations" });
    expect(within(table).getAllByRole("button", { name: /^Details of / }).map((button) => button.getAttribute("aria-label"))).toEqual(["Details of GET /status"]);
  });

  it("still lists the remaining steps after the steps a filter shows are all removed", async () => {
    const plan = quickPlan();
    const calls = stubFetch(
      routes(plan, (body) => {
        const excluded = (body as { excludedOperationKeys: string[] }).excludedOperationKeys;
        const removed = withoutKeys(plan, excluded.filter((key) => !plan.excludedOperationKeys.includes(key)));
        return { ...removed, stepsNeedingExpectedStatus: [] };
      }),
    );
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    fireEvent.click(screen.getByRole("button", { name: "Needs expected status · 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select GET /status" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Selected operations" })).getByRole("button", { name: "Remove from plan" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    // The filter's chip is gone with its last step, so the filter no longer hides the other six.
    const table = await screen.findByRole("table", { name: "Performance plan operations" });
    await waitFor(() => expect(within(table).getAllByRole("button", { name: /^Details of / })).toHaveLength(6));
    expect(screen.queryByRole("button", { name: /^Needs expected status/ })).not.toBeInTheDocument();
    expect(screen.getByText("6 of 6 steps shown")).toBeInTheDocument();
  });

  it("opens a step's details in a row under it, and closes them again", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByRole("button", { name: "Details of POST /orders" });
    const button = detailsButton("POST /orders");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "Details for POST /orders" });
    expect(details.closest("tr")?.previousElementSibling).toBe(rowOf("POST /orders"));
    expect(details).toHaveTextContent("POST /orders happy path");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Details for POST /orders" })).not.toBeInTheDocument();
  });

  it("opens an operation's details in the table from the write list, including the one beside the trigger", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    const list = await screen.findByTestId("write-summary-plan-list");
    fireEvent.click(within(list).getByRole("button", { name: "Show PATCH /orders/{orderId} in the plan" }));
    expect(detailsButton("PATCH /orders/{orderId}")).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(detailsButton("PATCH /orders/{orderId}"));

    fireEvent.click(screen.getByRole("button", { name: /^Run setup/ }));
    const trigger = screen.getByTestId("write-summary-trigger-list");
    fireEvent.click(within(trigger).getByRole("button", { name: "Show DELETE /products/{productId} in the plan" }));
    expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    expect(document.activeElement).toBe(detailsButton("DELETE /products/{productId}"));
  });

  it("labels a removed operation only when there is a reason beyond having been removed", async () => {
    stubFetch(routes(quickPlan({ excludedOperationKeys: ["POST /auth/login", "GET /orders"] })));
    renderScreen();
    const removed = await screen.findByTestId("performance-removed-list");
    const items = within(removed).getAllByRole("listitem");
    expect(items.find((item) => item.textContent?.includes("/auth/login"))).toHaveTextContent("used to acquire the run's credentials");
    expect(items.find((item) => item.textContent?.includes("/orders"))).not.toHaveTextContent("Removed");
  });

  it("opens the step and focuses its editor from the row's own status button", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    const table = await screen.findByRole("table", { name: "Performance plan operations" });
    fireEvent.click(within(table).getByRole("button", { name: "Set the expected status of GET /status" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Add an expected status for GET /status"));
  });
});

describe("PerformancePlanScreen pending bar and Run setup", () => {
  const readyPlan = () =>
    quickPlan({
      stepsNeedingExpectedStatus: [],
      journeys: quickPlan().journeys.filter((journey) => journey.steps[0].operationKey !== "GET /status"),
    });
  const pendingBar = () => screen.getByRole("region", { name: "What still blocks a run" });

  it("lists what still blocks a run above the tabs, each with its action, and counts the setup items on the tab", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    const bar = pendingBar();
    expect(bar).toHaveTextContent("Before you can run: 2 things left");
    expect(bar).toHaveTextContent("1 step needs an expected status before the script can be generated.");
    expect(bar).toHaveTextContent("The k6 script has not been generated.");
    expect(within(bar).getByRole("button", { name: "Generate the k6 script" })).toBeDisabled();
    // The environment is chosen (perf-local), so it is not pending; missing values never block.
    expect(bar).not.toHaveTextContent("target environment");
    expect(screen.getByRole("button", { name: "Run setup (1 to do)" })).toBeInTheDocument();
  });

  it("shows the steps needing a status in the Plan tab from the pending bar", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    fireEvent.click(screen.getByRole("button", { name: /^Run setup/ }));
    fireEvent.click(within(pendingBar()).getByRole("button", { name: "Show the steps that need an expected status" }));
    expect(screen.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Needs expected status · 1" })).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "Performance plan operations" });
    expect(within(table).getAllByRole("button", { name: /^Details of / })).toHaveLength(1);
  });

  it("says a missing environment is pending and takes you to it", async () => {
    stubFetch({ ...routes(quickPlan()), "GET /api/test-generation-workflow/environments": () => [200, { environments: [] }] });
    renderScreen();
    await screen.findByRole("button", { name: "Details of GET /orders" });
    expect(pendingBar()).toHaveTextContent("No target environment yet.");
    expect(screen.getByRole("button", { name: "Run setup (2 to do)" })).toBeInTheDocument();
    fireEvent.click(within(pendingBar()).getByRole("button", { name: "Set up the target environment" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Target environment and values" }));
  });

  it("says the plan is ready and where to run it, without a trigger of its own (FR-011)", async () => {
    stubFetch({ ...routes(readyPlan()), [`GET ${QUICK}/plan`]: () => [200, { plan: readyPlan(), script: script() }] });
    renderScreen();
    const bar = await screen.findByText(/Ready to run on perf-local \(local\)/);
    expect(bar).toHaveTextContent("5 write operations will be sent");
    expect(within(pendingBar()).queryByRole("button", { name: /^Run on/ })).not.toBeInTheDocument();
    fireEvent.click(within(pendingBar()).getByRole("button", { name: "Go to run →" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Run" }));
    expect(screen.getByRole("button", { name: "Run on perf-local (local)" })).toBeEnabled();
  });

  it("switches to the Runs tab when a run starts, where the live run names its target (AP-029 FR-025)", async () => {
    stubFetch({
      ...routes(readyPlan()),
      [`GET ${QUICK}/plan`]: () => [200, { plan: readyPlan(), script: script() }],
      [`POST ${QUICK}/runs`]: () => [200, { run: runFixture({ planSource: "quick" }) }],
      [`GET ${QUICK}/runs/run-12345678`]: () => [200, { run: runFixture({ planSource: "quick" }) }],
    });
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /^Run setup/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Run on perf-local (local)" }));
    expect(await screen.findByRole("heading", { name: /Run run-1234/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Runs & reports/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("live-run-target")).toHaveTextContent("perf-local");
    expect(screen.getByTestId("live-run-target")).toHaveTextContent("Tier: local");
    expect(pendingBar()).toHaveTextContent("Run in progress");
    expect(screen.queryByRole("table", { name: "Performance plan operations" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(screen.getByRole("table", { name: "Performance plan operations" })).toBeInTheDocument();
  });
});

describe("PerformancePlanScreen lists at scale (US5)", () => {
  it("counts the steps needing an expected status, and each row moves focus to that step's editor (FR-024)", async () => {
    const steps = Array.from({ length: 60 }, (_, index) => quickStep("GET", `/s${index}`, { expectedStatuses: [] }));
    const plan = quickPlan({
      journeys: steps.map((step) => ({ id: `j-${step.id}`, source: { kind: "operation" as const }, steps: [step] })),
      stepsNeedingExpectedStatus: steps.map((step) => step.id),
    });
    stubFetch(routes(plan));
    renderScreen();
    const list = await screen.findByTestId("performance-needs-status-list");
    expect(list.tagName).toBe("DETAILS");
    expect(within(list).getByText("60 steps to set")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Set the expected status of GET /s7" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Add an expected status for GET /s7"));
    // A step on the second page of the table is brought on screen too.
    fireEvent.click(within(list).getByRole("button", { name: "Set the expected status of GET /s55" }));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByLabelText("Add an expected status for GET /s55"));
  });

  it("shows left-out operations as a counted list, collapsed when longer than ten (FR-024, US5 AS1)", async () => {
    const omitted = Array.from({ length: 30 }, (_, index) => ({ operationKey: `GET /left${String(index).padStart(2, "0")}`, reason: "no-positive-scenario" as const }));
    stubFetch(routes(quickPlan({ omitted })));
    renderScreen();
    const list = await screen.findByTestId("performance-omitted-list");
    expect(list.tagName).toBe("DETAILS");
    expect(within(list).getByText("30 operations left out")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(30);
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("No positive scenario");
  });
});
