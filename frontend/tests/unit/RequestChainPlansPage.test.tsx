import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RequestChainPlansPage } from "../../src/pages/RequestChainPlansPage";
import { stubFetch } from "./performanceFixtures";
import { chainPlanFixture, PLAN_ID, viewOf } from "./requestChainFixtures";

/** AP-037 (specs/037-request-chain-performance tasks T023; FR-039). */

const BASE = "/api/chain-plans";
/** What the opened editor reads. */
const EDITOR_ROUTES = {
  [`GET ${BASE}/${PLAN_ID}`]: () => [200, viewOf(chainPlanFixture())] as [number, unknown],
  ["GET /api/test-generation-workflow/environments"]: () => [200, { environments: [] }] as [number, unknown],
  [`GET ${BASE}/${PLAN_ID}/runs`]: () => [200, { runs: [] }] as [number, unknown],
  [`GET ${BASE}/readiness`]: () => [200, { readiness: { state: "ready", version: "1.2.0", checkedAt: "t" } }] as [number, unknown],
};
const SUMMARY = { id: PLAN_ID, name: "Customer lifecycle", chainCount: 2, stepCount: 7, dataSetCount: 1, seedSource: "specification", updatedAt: "2026-10-03T10:00:00.000Z" };

afterEach(() => vi.unstubAllGlobals());

describe("RequestChainPlansPage", () => {
  it("lists the session's plans with their counts and seed source", async () => {
    stubFetch({ [`GET ${BASE}`]: () => [200, { plans: [SUMMARY] }] });
    render(<RequestChainPlansPage />);
    const row = (await screen.findByText("Customer lifecycle")).closest("tr")!;
    expect(within(row).getByText("Seeded from a specification")).toBeInTheDocument();
    expect(within(row).getByText("7")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Open Customer lifecycle" })).toBeInTheDocument();
  });

  it("shows the empty state, and an error state with a retry", async () => {
    let fail = true;
    stubFetch({ [`GET ${BASE}`]: () => (fail ? [500, { error: "internal_error", message: "boom" }] : [200, { plans: [] }]) });
    render(<RequestChainPlansPage />);
    expect(await screen.findByTestId("chain-plans-error")).toHaveTextContent("The plans could not be loaded.");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("chain-plans-empty")).toHaveTextContent("No plans yet");
  });

  it("creates a plan with the name entered and opens it", async () => {
    const calls = stubFetch({
      ...EDITOR_ROUTES,
      [`GET ${BASE}`]: () => [200, { plans: [] }],
      [`POST ${BASE}`]: () => [201, viewOf(chainPlanFixture({ name: "Checkout" }))],
    });
    render(<RequestChainPlansPage />);
    await screen.findByTestId("chain-plans-empty");
    fireEvent.click(screen.getByRole("button", { name: "New plan" }));
    fireEvent.change(screen.getByLabelText("Plan name"), { target: { value: "Checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan" }));
    expect(await screen.findByTestId("chain-plan-editor")).toHaveAttribute("data-plan-id", PLAN_ID);
    expect(await screen.findByTestId("chain-plan-name")).toHaveTextContent("Customer lifecycle");
    expect(calls.find((call) => call.method === "POST" && call.url === BASE)?.body).toEqual({ name: "Checkout" });
  });

  it("deletes a plan after confirmation, saying its runs are kept", async () => {
    let plans = [SUMMARY];
    const calls = stubFetch({
      [`GET ${BASE}`]: () => [200, { plans }],
      [`DELETE ${BASE}/${PLAN_ID}`]: () => {
        plans = [];
        return [204, undefined];
      },
    });
    render(<RequestChainPlansPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete Customer lifecycle" }));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).getByText(/past runs and their reports are kept/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete plan (1)" }));
    expect(await screen.findByTestId("chain-plans-empty")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });

  it("opens a plan another view asked for", async () => {
    stubFetch({ ...EDITOR_ROUTES, [`GET ${BASE}`]: () => [200, { plans: [SUMMARY] }] });
    render(<RequestChainPlansPage openRequest={{ planId: PLAN_ID, nonce: 1 }} />);
    await waitFor(() => expect(screen.getByTestId("chain-plan-editor")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "← All plans" }));
    expect(await screen.findByText("Customer lifecycle")).toBeInTheDocument();
  });
});
