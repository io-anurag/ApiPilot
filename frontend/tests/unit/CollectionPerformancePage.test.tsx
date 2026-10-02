import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CollectionPerformanceTestView, PerformancePlan } from "@apipilot/shared-domain";
import { CollectionPerformancePage } from "../../src/pages/CollectionPerformancePage";
import { collectionPlanFixture, environment, stubFetch, type Call } from "./performanceFixtures";

/** AP-036 User Story 1, FR-018, FR-022, FR-025 (research R18, R20; tasks T031). */

const BASE = "/api/collection-performance";

function view(plan: PerformancePlan = collectionPlanFixture(), state: CollectionPerformanceTestView["collection"]["state"] = "current"): CollectionPerformanceTestView {
  return { collection: { id: "c-1", name: "APIFoundry", tier: "local", state }, plan, script: null };
}

function planRoutes(plan: PerformancePlan, extra: Record<string, Parameters<typeof stubFetch>[0][string]> = {}) {
  return {
    [`GET ${BASE}/plan`]: () => [200, { plan, script: null }] as [number, unknown],
    "GET /api/test-generation-workflow/environments": () => [200, { environments: [environment()] }] as [number, unknown],
    [`GET ${BASE}/plan/values`]: () =>
      [200, { environment: { id: "env-1", name: "perf-local", tier: "local", baseUrl: "http://127.0.0.1:4600" }, values: plan.userSuppliedValues.map((value) => ({ ...value, present: true })) }] as [
        number,
        unknown,
      ],
    [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "x" } }] as [number, unknown],
    [`GET ${BASE}/runs`]: () => [200, { runs: [] }] as [number, unknown],
    ...extra,
  };
}

function builds(calls: Call[]): Call[] {
  return calls.filter((call) => call.method === "POST" && call.url === BASE);
}

afterEach(() => vi.unstubAllGlobals());

describe("CollectionPerformancePage", () => {
  it("says how to start when the session has no collection plan", async () => {
    stubFetch({ [`GET ${BASE}`]: () => [404, { error: "collection_plan_not_found", message: "none" }] });
    render(<CollectionPerformancePage />);
    expect(await screen.findByTestId("collection-performance-empty")).toHaveTextContent("choose Set up a performance test");
  });

  it("shows an error, not an empty state, when the plan cannot be read", async () => {
    stubFetch({ [`GET ${BASE}`]: () => [500, { error: "internal_error", message: "boom" }] });
    render(<CollectionPerformancePage />);
    expect(await screen.findByTestId("collection-performance-error")).toBeInTheDocument();
  });

  it("builds from the hand-off and shows the collection, the review gate and the credential requests", async () => {
    const plan = collectionPlanFixture();
    const calls = stubFetch(planRoutes(plan, { [`POST ${BASE}`]: () => [200, { collectionTest: view(plan) }] }));
    render(<CollectionPerformancePage request={{ collectionId: "c-1", orderedRequestIds: ["req-token", "req-create", "req-read"], nonce: 1 }} />);
    expect(await screen.findByTestId("collection-performance-plan")).toBeInTheDocument();
    expect(builds(calls)[0].body).toEqual({ collectionId: "c-1", orderedRequestIds: ["req-token", "req-create", "req-read"], replaceExisting: false });
    expect(screen.getByText("APIFoundry", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Collection unchanged")).toBeInTheDocument();
    expect(await screen.findByText("Review the conversion before the script can be generated.")).toBeInTheDocument();
    expect(screen.getByTestId("conversion-review")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run once before the load" })).toBeInTheDocument();
    expect(screen.getByTestId("performance-generate-blocked")).toHaveTextContent("Review the conversion first");
    expect(screen.getByRole("button", { name: /Details of POST \/api\/v1\/customers/ })).toHaveTextContent("Customers / Create customer");
  });

  it("asks before replacing an existing plan, and replaces it on confirm", async () => {
    const plan = collectionPlanFixture();
    let attempt = 0;
    const calls = stubFetch(
      planRoutes(plan, {
        [`POST ${BASE}`]: () => {
          attempt += 1;
          return attempt === 1 ? [409, { error: "collection_plan_exists", message: "exists" }] : [200, { collectionTest: view(plan) }];
        },
        [`GET ${BASE}`]: () => [200, { collectionTest: view(plan) }],
      }),
    );
    render(<CollectionPerformancePage request={{ collectionId: "c-1", orderedRequestIds: ["req-create"], nonce: 1 }} />);
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("Replace the current collection performance plan");
    fireEvent.click(within(dialog).getByRole("button", { name: /Replace/ }));
    await waitFor(() => expect(builds(calls)).toHaveLength(2));
    expect(builds(calls)[1].body).toMatchObject({ replaceExisting: true });
  });

  it("offers Rebuild for a changed collection, blocks the script, and names the settings a rebuild could not keep", async () => {
    const plan = collectionPlanFixture({ collectionState: "changed", review: { reviewed: true, conversionDigest: "c".repeat(64) } });
    const rebuilt = collectionPlanFixture();
    stubFetch(
      planRoutes(plan, {
        [`GET ${BASE}`]: () => [200, { collectionTest: view(plan, "changed") }],
        [`POST ${BASE}/rebuild`]: () => [200, { collectionTest: view(rebuilt), notKept: [{ stepId: "s-read", itemId: "req-read", name: "Get customer", settings: ["expected-statuses"] }], droppedRequestIds: [] }],
      }),
    );
    render(<CollectionPerformancePage />);
    expect(await screen.findByText("Collection changed")).toBeInTheDocument();
    expect(await screen.findByTestId("performance-generate-blocked")).toHaveTextContent("The collection changed since this plan was built");
    fireEvent.click(screen.getAllByRole("button", { name: /Rebuild/ })[0]);
    expect(await screen.findByText(/These settings could not be kept: Get customer \(expected statuses\)/)).toBeInTheDocument();
    expect(await screen.findByText("Collection unchanged")).toBeInTheDocument();
  });

  it("explains that a deleted collection's plan cannot be run or rebuilt", async () => {
    const plan = collectionPlanFixture({ collectionState: "deleted" });
    stubFetch(planRoutes(plan, { [`GET ${BASE}`]: () => [200, { collectionTest: view(plan, "deleted") }] }));
    render(<CollectionPerformancePage />);
    expect((await screen.findAllByText(/cannot be run or rebuilt/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Rebuild" })).not.toBeInTheDocument();
  });

  it("lists left-out requests in a searchable table with their reasons (FR-004, R20)", async () => {
    const plan = collectionPlanFixture({
      leftOut: [
        { itemId: "req-upload", name: "Upload", folderPath: [], method: "POST", path: "/upload", reason: "unsupported-body", detail: "formdata" },
        { itemId: "req-version", name: "Version", folderPath: [], method: "GET", path: "/version", reason: "unsupported-auth", detail: "digest" },
      ],
    });
    stubFetch(planRoutes(plan, { [`GET ${BASE}`]: () => [200, { collectionTest: view(plan) }] }));
    render(<CollectionPerformancePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Left out/ }));
    const table = screen.getByRole("table", { name: "Operations left out" });
    expect(table).toHaveTextContent("Its auth (digest) cannot be sent under load.");
    fireEvent.change(screen.getByPlaceholderText("Search method or path"), { target: { value: "version" } });
    expect(screen.getByText("1 of 2 operations shown")).toBeInTheDocument();
  });
});
