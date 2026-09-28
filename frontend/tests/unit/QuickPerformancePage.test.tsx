import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QuickPerformancePage } from "../../src/pages/QuickPerformancePage";
import { environment, quickPlan, quickTestView, stubFetch, type Call } from "./performanceFixtures";

/** AP-032 US1 and US3 quick page (specs/032-quick-performance-test tasks T022, T053). */

const QUICK = "/api/quick-performance";

function planRoutes(plan = quickPlan(), extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  return {
    [`GET ${QUICK}/plan`]: () => [200, { plan, script: null }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    [`GET ${QUICK}/plan/values`]: () =>
      [200, {
        environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" },
        values: plan.userSuppliedValues.map((value) => ({ ...value, present: value.name === "baseUrl" })),
      }] as [number, unknown],
    [`GET ${QUICK}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${QUICK}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    ...extra,
  };
}

function specificationFile(name = "quick-performance.yaml"): File {
  return new File(["openapi: 3.0.3"], name, { type: "application/yaml" });
}

function uploads(calls: Call[]): Call[] {
  return calls.filter((call) => call.method === "POST" && call.url.split("?")[0] === QUICK);
}

afterEach(() => vi.unstubAllGlobals());

describe("QuickPerformancePage", () => {
  it("goes from an upload straight to the plan, with no review stage", async () => {
    stubFetch(
      planRoutes(quickPlan(), {
        [`GET ${QUICK}`]: () => [404, { error: "quick_test_not_found", message: "none" }],
        [`POST ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
      }),
    );
    render(<QuickPerformancePage onExit={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Upload OpenAPI specification for a quick performance test"), { target: { files: [specificationFile()] } });

    expect(await screen.findByTestId("quick-performance-plan")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Details of GET /orders" })).toBeInTheDocument();
    expect(screen.getByText("Quick Performance Fixture")).toBeInTheDocument();
    expect(screen.getByText(/generated requests that no one reviewed/)).toBeInTheDocument();
    expect(screen.getByText(/not chained/)).toBeInTheDocument();
    for (const stage of ["API Review", "Scenario Review", "AI Enhancement", "Workflow Review", "Postman Generation"]) {
      expect(screen.queryByText(stage)).not.toBeInTheDocument();
    }
  });

  it("shows the server's upload error and no plan", async () => {
    stubFetch({
      [`GET ${QUICK}`]: () => [404, { error: "quick_test_not_found", message: "none" }],
      [`POST ${QUICK}`]: () => [400, { error: "unsupported_version", message: "Only OpenAPI 3.x is supported." }],
    });
    render(<QuickPerformancePage onExit={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Upload OpenAPI specification for a quick performance test"), { target: { files: [specificationFile()] } });
    expect(await screen.findByText("Only OpenAPI 3.x is supported.")).toBeInTheDocument();
    expect(screen.queryByTestId("quick-performance-plan")).not.toBeInTheDocument();
  });

  it("resumes the session's quick test, asks before replacing it, and sends nothing on cancel", async () => {
    const calls = stubFetch(planRoutes(quickPlan(), { [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }] }));
    render(<QuickPerformancePage onExit={() => undefined} />);
    await screen.findByTestId("quick-performance-plan");

    fireEvent.change(screen.getByLabelText("Upload a new specification for the quick performance test"), { target: { files: [specificationFile("other.yaml")] } });
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("Runs and reports are kept.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    expect(uploads(calls)).toHaveLength(0);
  });

  it("replaces the quick test after confirmation", async () => {
    const calls = stubFetch(
      planRoutes(quickPlan(), {
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
        [`POST ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
      }),
    );
    render(<QuickPerformancePage onExit={() => undefined} />);
    await screen.findByTestId("quick-performance-plan");
    fireEvent.change(screen.getByLabelText("Upload a new specification for the quick performance test"), { target: { files: [specificationFile("other.yaml")] } });
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Replace/ }));
    await waitFor(() => expect(uploads(calls)).toHaveLength(1));
    expect(uploads(calls)[0].url).toContain("replaceExisting=true");
  });

  it("says nothing can be load-tested when the plan has no journeys, lists what was left out, and offers Back to start", async () => {
    const empty = quickPlan({
      journeys: [],
      excludedOperationKeys: [],
      credentialProducerOperationKeys: [],
      stepsNeedingExpectedStatus: [],
      omitted: [{ operationKey: "GET /a", reason: "no-positive-scenario" }],
    });
    const onExit = vi.fn();
    stubFetch(planRoutes(empty, { [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView(empty) }] }));
    render(<QuickPerformancePage onExit={onExit} />);
    expect(await screen.findByText("Nothing can be load-tested")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to start from an empty plan" }));
    expect(onExit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Left out 1" }));
    expect(screen.getByRole("table", { name: "Operations left out" })).toHaveTextContent("/a");
  });

  it("calls onExit from Back to start", async () => {
    const onExit = vi.fn();
    stubFetch({ [`GET ${QUICK}`]: () => [404, { error: "quick_test_not_found", message: "none" }] });
    render(<QuickPerformancePage onExit={onExit} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exit the quick performance test and return to the start screen" }));
    expect(onExit).toHaveBeenCalled();
  });

  it("lists the login as used to acquire the run's credentials, and restores it", async () => {
    const calls = stubFetch(
      planRoutes(quickPlan(), {
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
        [`PUT ${QUICK}/plan`]: () => [200, { plan: quickPlan({ excludedOperationKeys: [] }), script: null }],
      }),
    );
    render(<QuickPerformancePage onExit={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Removed 1" }));
    const removed = screen.getByRole("table", { name: "Removed operations" });
    expect(removed).toHaveTextContent("/auth/login");
    expect(removed).toHaveTextContent("used to acquire the run's credentials");
    fireEvent.click(within(removed).getByRole("button", { name: "Restore POST /auth/login" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT")).toBe(true));
    expect(calls.find((call) => call.method === "PUT")!.body).toEqual({ excludedOperationKeys: [] });
  });

  it("says the plan has no operations when every operation was removed, and blocks generation with that reason", async () => {
    const allRemoved = quickPlan({ journeys: [], stepsNeedingExpectedStatus: [], excludedOperationKeys: ["GET /orders", "POST /auth/login"] });
    stubFetch(planRoutes(allRemoved, { [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView(allRemoved) }] }));
    render(<QuickPerformancePage onExit={() => undefined} />);
    expect(await screen.findByText("The plan has no operations")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What still blocks a run" })).toHaveTextContent("Every operation was removed.");
    fireEvent.click(screen.getByRole("button", { name: /^Run setup/ }));
    expect(screen.getByRole("button", { name: "Generate script" })).toBeDisabled();
    expect(screen.getByTestId("performance-generate-blocked")).toHaveTextContent("The plan has no operations");
  });

  it("creates and chooses an environment with no guided workflow, and runs through the quick routes (US3)", async () => {
    const calls = stubFetch(
      planRoutes(quickPlan(), {
        [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
      }),
    );
    render(<QuickPerformancePage onExit={() => undefined} />);
    await screen.findByTestId("quick-performance-plan");
    await waitFor(() => expect(calls.some((call) => call.url.startsWith(`${QUICK}/plan/values`))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /^Run setup/ }));
    const checklist = await screen.findByRole("table", { name: "Values the plan needs from the environment" });
    expect(checklist).toHaveTextContent("password");
    expect(calls.some((call) => call.url.startsWith(`${QUICK}/readiness`))).toBe(true);
    expect(calls.some((call) => call.url.startsWith("/api/test-generation-workflow/performance"))).toBe(false);
  });
});
