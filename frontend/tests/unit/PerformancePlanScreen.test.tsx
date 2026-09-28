import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PerformancePlan } from "@apipilot/shared-domain";
import { PerformancePlanScreen } from "../../src/components/performance/PerformancePlanScreen";
import { quickPerformanceClient } from "../../src/services/quickPerformanceClient";
import { environment, quickPlan, quickStep, stubFetch } from "./performanceFixtures";

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

afterEach(() => vi.unstubAllGlobals());

describe("PerformancePlanScreen write visibility (US2)", () => {
  it("marks each write step with its effect in text beside its method badge (FR-010)", async () => {
    stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByText("GET /orders happy path");
    const rowOf = (description: string) => screen.getByText(description).closest("tr")!;
    expect(rowOf("POST /orders happy path")).toHaveTextContent("Creates");
    expect(rowOf("PUT /orders/{orderId} happy path")).toHaveTextContent("Replaces");
    expect(rowOf("PATCH /orders/{orderId} happy path")).toHaveTextContent("Updates");
    expect(rowOf("DELETE /orders/{orderId} happy path")).toHaveTextContent("Deletes");
    expect(rowOf("GET /orders happy path")).not.toHaveTextContent(/Creates|Replaces|Updates|Deletes/);
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
    await screen.findByText("GET /orders happy path");

    fireEvent.click(screen.getByRole("button", { name: "Remove all DELETE operations" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1));
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({
      excludedOperationKeys: ["POST /auth/login", "DELETE /orders/{orderId}", "DELETE /products/{productId}"],
    });
    expect(await screen.findByTestId("write-summary-plan")).toHaveTextContent("3 write operations will be sent");
    expect(screen.getByTestId("performance-removed-list")).toHaveTextContent("/products/{productId}");

    fireEvent.click(screen.getByRole("button", { name: "Remove all write operations" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PUT")).toHaveLength(2));
    const second = calls.filter((call) => call.method === "PUT")[1].body as { excludedOperationKeys: string[] };
    expect(second.excludedOperationKeys).toEqual(expect.arrayContaining(["POST /orders", "PUT /orders/{orderId}", "PATCH /orders/{orderId}"]));
    expect(await screen.findByTestId("write-summary-plan")).toHaveTextContent("This plan sends only read requests.");
  });

  it("removes every operation of a read method in one action too (FR-014 covers every method present)", async () => {
    const calls = stubFetch(routes(quickPlan()));
    renderScreen();
    await screen.findByText("GET /orders happy path");
    fireEvent.click(screen.getByRole("button", { name: "Remove all GET operations" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({ excludedOperationKeys: ["POST /auth/login", "GET /orders", "GET /status"] });
  });
});

describe("PerformancePlanScreen lists at scale (US5)", () => {
  it("counts the steps needing an expected status, and each row moves focus to that step's editor (FR-024)", async () => {
    const steps = Array.from({ length: 12 }, (_, index) => quickStep("GET", `/s${index}`, { expectedStatuses: [] }));
    const plan = quickPlan({
      journeys: steps.map((step) => ({ id: `j-${step.id}`, source: { kind: "operation" as const }, steps: [step] })),
      stepsNeedingExpectedStatus: steps.map((step) => step.id),
    });
    stubFetch(routes(plan));
    renderScreen();
    const list = await screen.findByTestId("performance-needs-status-list");
    expect(list.tagName).toBe("DETAILS");
    expect(within(list).getByText("12 steps to set")).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Set the expected status of GET /s7" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Add an expected status for GET /s7"));
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
