import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CollectionRequestView } from "@apipilot/shared-domain";
import { ExternalCollectionRunPanel } from "../../src/components/ExternalCollectionRunPanel";
import { PerformanceTestingStage } from "../../src/components/performance/PerformanceTestingStage";
import { planFixture, stubFetch, type Call } from "./performanceFixtures";
import { chainPlanFixture, PLAN_ID, viewOf } from "./requestChainFixtures";

/** AP-037 (specs/037-request-chain-performance tasks T069; FR-020, US4). */

afterEach(() => vi.unstubAllGlobals());

function seedRoutes() {
  return {
    ["GET /api/test-generation-workflow/environments"]: () => [200, { environments: [] }] as [number, unknown],
    ["POST /api/chain-plans/seed"]: () => [201, { ...viewOf(chainPlanFixture()), movedCredentials: [] }] as [number, unknown],
  };
}

function seedBody(calls: Call[]): unknown {
  return calls.find((call) => call.method === "POST" && call.url === "/api/chain-plans/seed")?.body;
}

function requestView(id: string, name: string): CollectionRequestView {
  return { id, name, wasEdited: false, raw: { method: "GET", url: "https://example.test", headers: [] }, resolved: { method: "GET", url: "https://example.test", headers: [] }, unresolvedVariables: [], variableReferences: [], copiedScriptFolderIds: [] } as CollectionRequestView;
}

describe("Create request-chain plan from the guided Performance Testing stage", () => {
  it("seeds from the approved workflows and opens the new plan, leaving the stage's plan in place", async () => {
    const calls = stubFetch({
      ...seedRoutes(),
      ["GET /api/test-generation-workflow/performance/plan"]: () => [200, { plan: planFixture(), script: null }],
      ["GET /api/test-generation-workflow/performance/runs"]: () => [200, { runs: [] }],
      ["GET /api/test-generation-workflow/performance/readiness"]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "t" } }],
    });
    const onOpenChainPlan = vi.fn();
    render(<PerformanceTestingStage onOpenChainPlan={onOpenChainPlan} />);
    fireEvent.click(screen.getByRole("button", { name: "Create request-chain plan" }));
    const dialog = await screen.findByTestId("seed-plan-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(onOpenChainPlan).toHaveBeenCalledWith(PLAN_ID));
    expect(seedBody(calls)).toEqual({ name: "Guided workflow plan", source: { kind: "workflow" } });
  });

  it("offers nothing without a handler", () => {
    stubFetch({ ["GET /api/test-generation-workflow/performance/plan"]: () => [200, { plan: planFixture(), script: null }] });
    render(<PerformanceTestingStage />);
    expect(screen.queryByRole("button", { name: "Create request-chain plan" })).not.toBeInTheDocument();
  });
});

describe("Create request-chain plan from Import & Run Collection", () => {
  it("seeds from the selected requests in the run-order list's order", async () => {
    const calls = stubFetch(seedRoutes());
    const onOpenChainPlan = vi.fn();
    render(
      <ExternalCollectionRunPanel
        uploadedCollection={{ id: "uc-1", name: "APIFoundry", tier: "local", requestDelayMs: 0, createdAt: "2026-01-01" }}
        requests={[requestView("item-1", "Get token"), requestView("item-2", "Get health"), requestView("item-3", "Get version")]}
        runOrder={["item-3", "item-1", "item-2"]}
        onOpenChainPlan={onOpenChainPlan}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Include Get token in this run" }));
    fireEvent.click(screen.getByRole("button", { name: "Create request-chain plan" }));
    const dialog = await screen.findByTestId("seed-plan-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create plan" }));
    await waitFor(() => expect(onOpenChainPlan).toHaveBeenCalledWith(PLAN_ID));
    expect(seedBody(calls)).toEqual({ name: "APIFoundry", source: { kind: "collection", collectionId: "uc-1", orderedRequestIds: ["item-3", "item-2"] } });
  });
});
