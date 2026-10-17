import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PerformanceHome } from "../../src/components/performance/PerformanceHome";
import { stubFetch, type Call } from "./performanceFixtures";

/** AP-047 (specs/047-unified-performance-tab): FR-002 to FR-005, FR-031. */

const LEGACY_EMPTY = {
  ["GET /api/test-generation-workflow/performance/runs"]: () => [200, { runs: [] }] as [number, unknown],
  ["GET /api/quick-performance/runs"]: () => [200, { runs: [] }] as [number, unknown],
  ["GET /api/collection-performance/runs"]: () => [200, { runs: [] }] as [number, unknown],
};

const plan = (id: string, name: string, seedSource: "specification" | "collection" | "workflow" | null = "specification", updatedAt = "2026-10-03T10:00:00.000Z") => ({
  id,
  name,
  chainCount: 2,
  stepCount: 5,
  dataSetCount: 1,
  seedSource,
  updatedAt,
});

const run = (id: string, startedAt: string, status = "completed") => ({ id, planSource: "chain", planId: "p1", status, environment: { id: "e1", name: "perf-local", tier: "local", baseUrl: "http://x" }, scriptSha256: "s", k6Version: "1", plannedDurationMs: 1000, startedAt, cancelRequested: false });

const handlers = { onPick: () => undefined, onOpen: () => undefined };

afterEach(() => vi.unstubAllGlobals());

describe("PerformanceHome", () => {
  it("shows the source picker alone, with an introduction and no table, when there are no plans", async () => {
    stubFetch({ ...LEGACY_EMPTY, "GET /api/chain-plans": () => [200, { plans: [] }] });
    render(<PerformanceHome {...handlers} />);
    expect(await screen.findByRole("heading", { name: "Turn what you have into a load test" })).toBeInTheDocument();
    expect(screen.getByTestId("source-picker")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent runs")).not.toBeInTheDocument();
  });

  it("lists the saved plans with their source and counts, opens one, and reports the picked source", async () => {
    stubFetch({
      ...LEGACY_EMPTY,
      "GET /api/chain-plans": () => [200, { plans: [plan("p1", "Petstore smoke"), plan("p2", "Checkout journey", "collection"), plan("p3", "Built by hand", null)] }],
      "GET /api/chain-plans/p1/runs": () => [200, { runs: [] }],
      "GET /api/chain-plans/p2/runs": () => [200, { runs: [] }],
      "GET /api/chain-plans/p3/runs": () => [200, { runs: [] }],
    });
    const onOpen = vi.fn();
    const onPick = vi.fn();
    render(<PerformanceHome onOpen={onOpen} onPick={onPick} />);
    const table = await screen.findByRole("table", { name: "Saved performance plans" });
    expect(within(table).getByText("Seeded from a specification")).toBeInTheDocument();
    expect(within(table).getByText("Seeded from a collection")).toBeInTheDocument();
    expect(within(table).getByText("Built by you")).toBeInTheDocument();
    expect(screen.getByText("3 plans")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "Open Checkout journey" }));
    expect(onOpen).toHaveBeenCalledWith("p2");
    fireEvent.click(screen.getByRole("button", { name: /Postman collection/ }));
    expect(onPick).toHaveBeenCalledWith("collection");
  });

  it("duplicates a plan under the name given and reloads the list", async () => {
    let plans = [plan("p1", "Petstore smoke")];
    const calls = stubFetch({
      ...LEGACY_EMPTY,
      "GET /api/chain-plans": () => [200, { plans }],
      "GET /api/chain-plans/p1/runs": () => [200, { runs: [] }],
      "POST /api/chain-plans/p1/duplicate": () => {
        plans = [...plans, plan("p9", "Petstore smoke (copy)")];
        return [201, { plan: {}, analysis: {}, script: null }];
      },
    });
    render(<PerformanceHome {...handlers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Duplicate Petstore smoke" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Plan name")).toHaveValue("Petstore smoke (copy)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/p1/duplicate"))).toBe(true));
    expect(await screen.findByText("Petstore smoke (copy)")).toBeInTheDocument();
  });

  it("asks before deleting, says the runs and reports are kept, and changes nothing on Cancel", async () => {
    const calls: Call[] = stubFetch({
      ...LEGACY_EMPTY,
      "GET /api/chain-plans": () => [200, { plans: [plan("p1", "Petstore smoke")] }],
      "GET /api/chain-plans/p1/runs": () => [200, { runs: [] }],
      "DELETE /api/chain-plans/p1": () => [204, {}],
    });
    render(<PerformanceHome {...handlers} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Petstore smoke" }));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent("Its past runs and their reports are kept.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument());
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete Petstore smoke" }));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: /Delete plan/ }));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE")).toBe(true));
  });

  it("shows the plans' recent runs, newest first, with the plan's name and a text status", async () => {
    stubFetch({
      ...LEGACY_EMPTY,
      "GET /api/chain-plans": () => [200, { plans: [plan("p1", "Petstore smoke", "specification", "2026-10-03T10:00:00.000Z"), plan("p2", "Checkout journey", "collection", "2026-10-04T10:00:00.000Z")] }],
      "GET /api/chain-plans/p1/runs": () => [200, { runs: [run("r1", "2026-10-03T11:00:00.000Z", "failed")] }],
      "GET /api/chain-plans/p2/runs": () => [200, { runs: [run("r2", "2026-10-04T11:00:00.000Z", "completed")] }],
    });
    render(<PerformanceHome {...handlers} />);
    const runs = await screen.findByTestId("recent-runs");
    const rows = within(runs).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Checkout journey");
    expect(rows[0]).toHaveTextContent("Completed");
    expect(rows[1]).toHaveTextContent("Petstore smoke");
    expect(rows[1]).toHaveTextContent("Failed");
  });

  it("says when no plan has a run yet", async () => {
    stubFetch({ ...LEGACY_EMPTY, "GET /api/chain-plans": () => [200, { plans: [plan("p1", "Petstore smoke")] }], "GET /api/chain-plans/p1/runs": () => [200, { runs: [] }] });
    render(<PerformanceHome {...handlers} />);
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
  });

  it("shows an error with a retry when the plans cannot be loaded, not an empty list", async () => {
    let fail = true;
    stubFetch({ ...LEGACY_EMPTY, "GET /api/chain-plans": () => (fail ? [500, { error: "boom", message: "Could not read plans." }] : [200, { plans: [plan("p1", "Petstore smoke")] }]), "GET /api/chain-plans/p1/runs": () => [200, { runs: [] }] });
    render(<PerformanceHome {...handlers} />);
    expect(await screen.findByTestId("performance-plans-error")).toHaveTextContent("Could not read plans.");
    expect(screen.queryByRole("heading", { name: "Turn what you have into a load test" })).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Saved performance plans" })).toBeInTheDocument();
  });

  it("keeps the earlier runs of the retired plan kinds reachable, read only", async () => {
    stubFetch({
      ...LEGACY_EMPTY,
      "GET /api/quick-performance/runs": () => [200, { runs: [{ ...run("q1", "2026-09-01T10:00:00.000Z"), planSnapshot: {}, planSource: "quick" }] }],
      "GET /api/chain-plans": () => [200, { plans: [] }],
    });
    render(<PerformanceHome {...handlers} />);
    const section = await screen.findByTestId("legacy-runs");
    expect(section).toHaveTextContent("Recorded before request-chain plans");
  });

  it("has no exit control of its own: the sidebar leads home (AP-054)", async () => {
    stubFetch({ ...LEGACY_EMPTY, "GET /api/chain-plans": () => [200, { plans: [] }] });
    render(<PerformanceHome {...handlers} />);
    await screen.findByTestId("performance-home");
    expect(screen.queryByRole("button", { name: /Back to start|Exit performance testing/ })).not.toBeInTheDocument();
  });
});
