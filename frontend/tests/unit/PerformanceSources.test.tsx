import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PerformancePage } from "../../src/pages/PerformancePage";
import { quickTestView, stubFetch, type Call } from "./performanceFixtures";
import { baseRoutes, NO_QUICK_TEST, PLAN, QUICK, seededPlan } from "./performancePathFixtures";
import { chainPlanFixture, viewOf } from "./requestChainFixtures";

/** AP-047 (specs/047-unified-performance-tab US4, FR-007, FR-008): the empty plan, the guided workflow and a collection. */

const WORKFLOW = "/api/test-generation-workflow";
const COLLECTIONS = "/api/external-collections";

const workflow = (overrides: Record<string, unknown> = {}) => ({
  id: "w1",
  specificationFilename: "shop.yaml",
  apiModel: { operations: [1, 2, 3, 4, 5] },
  approvedWorkflowIds: ["wf-1", "wf-2"],
  stages: { postmanGeneration: { stageId: "postmanGeneration", status: "complete" } },
  ...overrides,
});

const collections = [
  { id: "col-1", name: "Shop collection", tier: "local", requestDelayMs: 0, createdAt: "2026-10-01" },
  { id: "col-2", name: "Other collection", tier: "qa", requestDelayMs: 0, createdAt: "2026-10-02" },
];
const request = (id: string, method: string, name: string, url: string) => ({ id, name, wasEdited: false, raw: { method, url, headers: [] }, resolved: { method, url, headers: [] }, unresolvedVariables: [] });
const collectionView = { id: "col-1", items: [request("r1", "POST", "Login", "{{base}}/login"), request("r2", "GET", "Cart", "{{base}}/cart"), request("r3", "POST", "Checkout", "{{base}}/checkout")], folders: [], variables: [] };

const calls = (all: Call[], suffix: string) => all.filter((call) => call.method === "POST" && call.url.endsWith(suffix));
const next = () => screen.getByRole("button", { name: "Next →" });
const current = () => screen.getAllByRole("listitem").find((item) => item.getAttribute("aria-current") === "step");

afterEach(() => vi.unstubAllGlobals());

describe("an empty plan", () => {
  it("is created at once, opens on its Plan step with Operations skipped, and cannot move on until it has a step", async () => {
    const empty = chainPlanFixture({ name: "New plan" });
    const all = stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => NO_QUICK_TEST,
        "GET /api/chain-plans": () => [200, { plans: [] }],
        "POST /api/chain-plans": () => [201, viewOf(empty)],
        [`GET ${PLAN}`]: () => [200, viewOf(empty)],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Empty plan/ }));
    await screen.findByLabelText("Plan name");
    expect(calls(all, "/api/chain-plans")[0].body).toEqual({ name: "New plan" });
    expect(current()).toHaveTextContent("Plan");
    expect(screen.getByTestId("performance-step-operations")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("performance-step-operations")).toHaveTextContent("Skipped for an empty plan");
    expect(screen.getByText("Built by you")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(screen.getByText("Add at least one step")).toBeInTheDocument();
    // Back from Plan skips the skipped step.
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(current()).toHaveTextContent("Source");
    expect(screen.getByText(/This plan was seeded from an empty plan/)).toBeInTheDocument();
  });

  it("shows why it could not be created, and stays on the entry screen", async () => {
    stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => NO_QUICK_TEST, "GET /api/chain-plans": () => [200, { plans: [] }], "POST /api/chain-plans": () => [409, { error: "plan_limit_exceeded", message: "A session holds at most 50 plans. Delete one first." }] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Empty plan/ }));
    expect(await screen.findByTestId("performance-open-error")).toHaveTextContent("A session holds at most 50 plans.");
    expect(screen.getByTestId("performance-home")).toBeInTheDocument();
  });
});

describe("the guided workflow", () => {
  const seededFromWorkflow = seededPlan({ name: "Guided workflow plan", seedingReport: { source: { kind: "workflow" }, seededAt: "t", items: [] } });

  it("opens on Workflows with a read-only summary, no selection, and seeds the workflow whole", async () => {
    const all = stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => NO_QUICK_TEST,
        "GET /api/chain-plans": () => [200, { plans: [] }],
        [`GET ${WORKFLOW}`]: () => [200, { workflow: workflow() }],
        "POST /api/chain-plans/seed": () => [201, { ...viewOf(seededFromWorkflow), movedCredentials: [] }],
        [`GET ${PLAN}`]: () => [200, viewOf(seededFromWorkflow)],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Guided workflow/ }));
    expect(current()).toHaveTextContent("Workflows");
    const summary = await screen.findByTestId("workflow-summary");
    expect(summary).toHaveTextContent("2 approved workflows");
    expect(summary).toHaveTextContent("3 other operations");
    expect(summary).toHaveTextContent("shop.yaml");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    await screen.findByLabelText("Plan name");
    expect(calls(all, "/seed")[0].body).toMatchObject({ source: { kind: "workflow" }, name: "Guided workflow plan" });
    expect(screen.getByText("Seeded from the guided workflow")).toBeInTheDocument();
  });

  it("says what to finish first, and keeps Next locked, until Postman generation is complete", async () => {
    stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => NO_QUICK_TEST,
        "GET /api/chain-plans": () => [200, { plans: [] }],
        [`GET ${WORKFLOW}`]: () => [200, { workflow: workflow({ stages: { postmanGeneration: { stageId: "postmanGeneration", status: "pending" } } }) }],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Guided workflow/ }));
    expect((await screen.findAllByText(/Finish the guided workflow up to Postman generation first/)).length).toBeGreaterThan(0);
    expect(next()).toBeDisabled();
  });

  it("says so when no guided workflow is in progress", async () => {
    stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => NO_QUICK_TEST, "GET /api/chain-plans": () => [200, { plans: [] }], [`GET ${WORKFLOW}`]: () => [204, null] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Guided workflow/ }));
    expect(await screen.findByTestId("workflow-summary-none")).toHaveTextContent("No guided workflow is in progress in this session.");
    expect(next()).toBeDisabled();
  });

  it("shows the server's refusal and stays on Workflows", async () => {
    stubFetch(
      baseRoutes({
        [`GET ${QUICK}`]: () => NO_QUICK_TEST,
        "GET /api/chain-plans": () => [200, { plans: [] }],
        [`GET ${WORKFLOW}`]: () => [200, { workflow: workflow() }],
        "POST /api/chain-plans/seed": () => [409, { error: "workflow_not_ready", message: "Finish the guided workflow up to Postman generation first." }],
      }),
    );
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Guided workflow/ }));
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    expect(await screen.findByTestId("plan-create-error")).toHaveTextContent("Finish the guided workflow up to Postman generation first.");
    expect(current()).toHaveTextContent("Workflows");
  });
});

describe("a Postman collection", () => {
  const seededFromCollection = seededPlan({ name: "Shop collection", seedingReport: { source: { kind: "collection", collectionId: "col-1", collectionName: "Shop collection" }, seededAt: "t", items: [] } });

  function routes(extra: Parameters<typeof stubFetch>[0] = {}) {
    return baseRoutes({
      [`GET ${QUICK}`]: () => NO_QUICK_TEST,
      "GET /api/chain-plans": () => [200, { plans: [] }],
      [`GET ${COLLECTIONS}`]: () => [200, { uploadedCollections: collections }],
      [`GET ${COLLECTIONS}/col-1/collection`]: () => [200, { collectionView }],
      ...extra,
    });
  }

  it("asks for a collection, selects all its requests, and seeds the chosen ones in the collection's order", async () => {
    const all = stubFetch(routes({ "POST /api/chain-plans/seed": () => [201, { ...viewOf(seededFromCollection), movedCredentials: [] }], [`GET ${PLAN}`]: () => [200, viewOf(seededFromCollection)] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Postman collection/ }));
    expect(current()).toHaveTextContent("Requests");
    expect(next()).toBeDisabled();
    expect(screen.getByText("Choose at least one request")).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("Collection"), { target: { value: "col-1" } });
    const table = await screen.findByRole("table", { name: "Requests to include in the plan" });
    expect(await screen.findByText("3 of 3 selected")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("checkbox", { name: "Cart" }));
    expect(screen.getByText("2 of 3 selected")).toBeInTheDocument();
    fireEvent.click(next());
    await screen.findByLabelText("Plan name");
    expect(calls(all, "/seed")[0].body).toMatchObject({ name: "Shop collection", source: { kind: "collection", collectionId: "col-1", orderedRequestIds: ["r1", "r3"] } });
    expect(screen.getByText("Seeded from the collection Shop collection")).toBeInTheDocument();
  });

  it("filters a long list, and selects or clears every request at once", async () => {
    stubFetch(routes());
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Postman collection/ }));
    fireEvent.change(await screen.findByLabelText("Collection"), { target: { value: "col-1" } });
    await screen.findByText("3 of 3 selected");
    fireEvent.change(screen.getByLabelText("Filter requests"), { target: { value: "checkout" } });
    expect(screen.getByRole("checkbox", { name: "Checkout" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Cart" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter requests"), { target: { value: "nothing" } });
    expect(screen.getByText("No requests match the filter.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter requests"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Select all/ }));
    expect(screen.getByText("0 of 3 selected")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select all/ }));
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
  });

  it("says so when no collection is imported", async () => {
    stubFetch(routes({ [`GET ${COLLECTIONS}`]: () => [200, { uploadedCollections: [] }] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Postman collection/ }));
    expect(await screen.findByTestId("no-collections")).toHaveTextContent("No Postman collection is imported in this session.");
    expect(next()).toBeDisabled();
  });

  it("shows why the collections or the requests could not be loaded", async () => {
    stubFetch(routes({ [`GET ${COLLECTIONS}/col-1/collection`]: () => [500, { error: "boom", message: "Could not read the collection." }] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Postman collection/ }));
    fireEvent.change(await screen.findByLabelText("Collection"), { target: { value: "col-1" } });
    expect(await screen.findByTestId("collection-view-error")).toHaveTextContent("Could not read the collection.");
    expect(next()).toBeDisabled();
  });
});

describe("changing the source before a plan exists", () => {
  it("clears the selection of the earlier source", async () => {
    stubFetch(baseRoutes({ [`GET ${QUICK}`]: () => [200, { quickTest: quickTestView() }], "GET /api/chain-plans": () => [200, { plans: [] }], [`GET ${COLLECTIONS}`]: () => [200, { uploadedCollections: collections }] }));
    render(<PerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
    await screen.findByTestId("operation-selection");
    fireEvent.click(screen.getByTestId("performance-step-source"));
    fireEvent.click(screen.getByRole("button", { name: /Postman collection/ }));
    fireEvent.click(next());
    expect(await screen.findByText("Choose at least one request")).toBeInTheDocument();
  });
});
