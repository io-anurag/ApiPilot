import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QuickPerformancePage } from "../../src/pages/QuickPerformancePage";
import { quickTestView, stubFetch, type Call } from "./performanceFixtures";

/**
 * AP-032 US1 quick page (specs/032-quick-performance-test tasks T022); since AP-037 phase two it seeds
 * request-chain plans (specs/037-request-chain-performance US5).
 */

const QUICK = "/api/quick-performance";

/** The routes the seeding panel reads: no plan has been created from a specification yet. */
const SEED_ROUTES = { "GET /api/chain-plans": () => [200, { plans: [] }] as [number, unknown] };

function specificationFile(name = "quick-performance.yaml"): File {
  return new File(["openapi: 3.0.3"], name, { type: "application/yaml" });
}

function uploads(calls: Call[]): Call[] {
  return calls.filter((call) => call.method === "POST" && call.url.split("?")[0] === QUICK);
}

afterEach(() => vi.unstubAllGlobals());

describe("QuickPerformancePage", () => {
  it("goes from an upload straight to seeding a request-chain plan, with no review stage", async () => {
    stubFetch({
      ...SEED_ROUTES,
      [`GET ${QUICK}`]: () => [404, { error: "quick_test_not_found", message: "none" }],
      [`POST ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
    });
    render(<QuickPerformancePage onExit={() => undefined} onOpenChainPlan={() => undefined} />);
    fireEvent.change(await screen.findByLabelText("Upload OpenAPI specification for a quick performance test"), { target: { files: [specificationFile()] } });

    const panel = await screen.findByTestId("quick-performance-plan");
    expect(screen.getByText("Quick Performance Fixture")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Create request-chain plan" })).toBeInTheDocument();
    expect(await within(panel).findByText("No plan has been created from this source yet.")).toBeInTheDocument();
    for (const stage of ["API Review", "Scenario Review", "AI Enhancement", "Workflow Review", "Postman Generation"]) {
      expect(screen.queryByText(stage)).not.toBeInTheDocument();
    }
  });

  it("lists the plans already created from a specification, and opens one", async () => {
    const onOpenChainPlan = vi.fn();
    stubFetch({
      [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
      "GET /api/chain-plans": () => [200, { plans: [
        { id: "p1", name: "From the specification", chainCount: 2, stepCount: 5, dataSetCount: 0, seedSource: "specification", updatedAt: "2026-10-03T10:00:00.000Z" },
        { id: "p2", name: "From a collection", chainCount: 1, stepCount: 3, dataSetCount: 0, seedSource: "collection", updatedAt: "2026-10-03T10:00:00.000Z" },
      ] }],
    });
    render(<QuickPerformancePage onExit={() => undefined} onOpenChainPlan={onOpenChainPlan} />);
    const list = await screen.findByTestId("seeded-plans");
    expect(within(list).getByText("From the specification")).toBeInTheDocument();
    expect(within(list).queryByText("From a collection")).not.toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Open From the specification" }));
    expect(onOpenChainPlan).toHaveBeenCalledWith("p1");
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
    const calls = stubFetch({ ...SEED_ROUTES, [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }] });
    render(<QuickPerformancePage onExit={() => undefined} />);
    await screen.findByTestId("quick-performance-plan");

    fireEvent.change(screen.getByLabelText("Upload a new specification for the quick performance test"), { target: { files: [specificationFile("other.yaml")] } });
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("and so are runs and reports.");
    expect(dialog).toHaveTextContent("Request-chain plans already created from it are kept");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    expect(uploads(calls)).toHaveLength(0);
  });

  it("replaces the quick test after confirmation", async () => {
    const calls = stubFetch({
      ...SEED_ROUTES,
      [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
      [`POST ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
    });
    render(<QuickPerformancePage onExit={() => undefined} />);
    await screen.findByTestId("quick-performance-plan");
    fireEvent.change(screen.getByLabelText("Upload a new specification for the quick performance test"), { target: { files: [specificationFile("other.yaml")] } });
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Replace/ }));
    await waitFor(() => expect(uploads(calls)).toHaveLength(1));
    expect(uploads(calls)[0].url).toContain("replaceExisting=true");
  });

  it("seeds only the operations the engineer leaves checked, and offers no plan with none", async () => {
    const calls = stubFetch({
      ...SEED_ROUTES,
      [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }],
      ["GET /api/test-generation-workflow/environments"]: () => [200, { environments: [] }],
      ["POST /api/chain-plans/seed"]: () => [201, { plan: { id: "p9" }, analysis: {}, script: null, movedCredentials: [] }],
    });
    render(<QuickPerformancePage onExit={() => undefined} onOpenChainPlan={() => undefined} />);
    const selection = await screen.findByTestId("operation-selection");
    expect(within(selection).getByText("3 of 3 selected")).toBeInTheDocument();
    expect(within(selection).getByRole("columnheader", { name: "Expected status" })).toBeInTheDocument();
    expect(within(selection).getByText("201")).toBeInTheDocument();
    expect(within(selection).getByRole("list", { name: "Variables of DELETE /customers/{id}" })).toHaveTextContent("id path*");

    fireEvent.click(within(selection).getByRole("checkbox", { name: "DELETE /customers/{id}" }));
    expect(within(selection).getByText("2 of 3 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create request-chain plan" }));
    fireEvent.click(within(await screen.findByTestId("seed-plan-dialog")).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/chain-plans/seed"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/api/chain-plans/seed"))?.body).toMatchObject({
      source: { kind: "specification", selectedOperationKeys: ["GET /customers", "POST /customers"] },
    });

    const selectAll = within(selection).getByRole("checkbox", { name: /Select all/ });
    fireEvent.click(selectAll);
    expect(within(selection).getByText("3 of 3 selected")).toBeInTheDocument();
    fireEvent.click(selectAll);
    expect(screen.getByRole("button", { name: "Create request-chain plan" })).toBeDisabled();
    expect(screen.getByText("Select at least one operation to create a plan.")).toBeInTheDocument();
  });

  it("calls onExit from Back to start", async () => {
    const onExit = vi.fn();
    stubFetch({ [`GET ${QUICK}`]: () => [404, { error: "quick_test_not_found", message: "none" }] });
    render(<QuickPerformancePage onExit={onExit} />);
    fireEvent.click(await screen.findByRole("button", { name: "Exit the quick performance test and return to the start screen" }));
    expect(onExit).toHaveBeenCalled();
  });
});
