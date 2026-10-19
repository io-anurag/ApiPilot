import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioListItem } from "@apipilot/shared-domain";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { BatchReviewBar } from "../../../src/components/securityLab/BatchReviewBar";
import * as client from "../../../src/services/securityLabClient";
import { NO_FLAGS, scenarioItem } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  listScenarioIds: vi.fn(),
  listAllScenarios: vi.fn(),
  reviewScenarios: vi.fn(),
}));

const listScenarioIds = vi.mocked(client.listScenarioIds);
const listAllScenarios = vi.mocked(client.listAllScenarios);
const reviewScenarios = vi.mocked(client.reviewScenarios);

function renderActive(ui: ReactElement) {
  return render(<ActiveViewContext.Provider value="security">{ui}</ActiveViewContext.Provider>);
}

const inReview = (id: string, overrides: Partial<ScenarioListItem> = {}) =>
  scenarioItem({ id, title: `Scenario ${id}`, reviewState: "in_review", currentVersion: 2, ...overrides });

const MIXED: ScenarioListItem[] = [
  inReview("ok-1"),
  inReview("ok-2"),
  inReview("ok-3"),
  inReview("destructive", { destructive: true, operationKey: "DELETE /orders/{id}" }),
  inReview("incomplete", { flags: { ...NO_FLAGS, blocked: true } }),
  inReview("stale", { flags: { ...NO_FLAGS, stale: true } }),
  scenarioItem({ id: "draft", title: "Scenario draft", reviewState: "draft", currentVersion: 2 }),
];

function serve(items: ScenarioListItem[], extra: { capped?: boolean; total?: number } = {}) {
  listScenarioIds.mockResolvedValue({
    ok: true,
    data: { items: items.map((item) => ({ id: item.id, version: item.currentVersion })), total: extra.total ?? items.length, capped: extra.capped ?? false },
  });
  listAllScenarios.mockResolvedValue({ ok: true, data: items });
}

async function openPanel(onReviewed = vi.fn(), filters: client.ScenarioFilterQuery = {}) {
  renderActive(<BatchReviewBar filters={filters} refreshToken={0} onReviewed={onReviewed} />);
  fireEvent.click(await screen.findByRole("button", { name: /^Review these \d+ scenarios? as a batch$/ }));
  await screen.findByTestId("batch-panel");
  return onReviewed;
}

const choose = (name: string) => fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${name}`) }));
const applyButton = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  listScenarioIds.mockReset();
  listAllScenarios.mockReset();
  reviewScenarios.mockReset();
});

describe("BatchReviewBar (T078, FR-031 to FR-033)", () => {
  it("resolves the current filter through the ids endpoint and shows the count, without reading every scenario yet", async () => {
    serve(MIXED);
    renderActive(<BatchReviewBar filters={{ severity: "high", q: "orders" }} refreshToken={0} onReviewed={vi.fn()} />);
    expect(await screen.findByTestId("batch-count")).toHaveTextContent("7 scenarios match the current filters.");
    expect(listScenarioIds).toHaveBeenCalledWith({ severity: "high", q: "orders" }, expect.objectContaining({ signal: expect.anything() }));
    expect(listAllScenarios).not.toHaveBeenCalled();
    expect(reviewScenarios).not.toHaveBeenCalled();
  });

  it("shows a loading state while the set is resolved, not an empty one", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.listScenarioIds>>) => void;
    listScenarioIds.mockReturnValue(new Promise((r) => (resolve = r)));
    renderActive(<BatchReviewBar filters={{}} refreshToken={0} onReviewed={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Resolving the set to review" })).toBeInTheDocument();
    expect(screen.queryByText(/nothing to review/)).not.toBeInTheDocument();
    resolve({ ok: true, data: { items: [], total: 0, capped: false } });
    expect(await screen.findByText(/No scenarios match the current filters, so there is nothing to review in bulk/)).toBeInTheDocument();
  });

  it("says a set that could not be resolved is an error with a retry, and offers no action", async () => {
    listScenarioIds.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderActive(<BatchReviewBar filters={{}} refreshToken={0} onReviewed={vi.fn()} />);
    expect(await screen.findByTestId("batch-ids-error")).toHaveTextContent("The Security Lab service is unreachable.");
    expect(screen.queryByRole("button", { name: /as a batch/ })).not.toBeInTheDocument();
    serve([inReview("a")]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Review these 1 scenario as a batch" })).toBeInTheDocument();
  });

  it("refuses to act on a capped set: it says so, asks to narrow the filter and offers no action", async () => {
    serve(MIXED, { capped: true, total: 6200 });
    renderActive(<BatchReviewBar filters={{}} refreshToken={0} onReviewed={vi.fn()} />);
    const banner = await screen.findByTestId("batch-capped");
    expect(banner).toHaveTextContent("The current filters match 6200 scenarios, more than the 7 a batch can name.");
    expect(banner).toHaveTextContent("Narrow the filters");
    expect(screen.getByTestId("batch-count")).toHaveTextContent("More than 7 scenarios match");
    expect(screen.queryByRole("button", { name: /as a batch/ })).not.toBeInTheDocument();
    expect(listAllScenarios).not.toHaveBeenCalled();
    expect(reviewScenarios).not.toHaveBeenCalled();
  });

  it("offers only the actions at least one scenario in the set can take", async () => {
    serve([inReview("a"), scenarioItem({ id: "b", reviewState: "draft", currentVersion: 2 })]);
    await openPanel();
    const names = screen.getAllByRole("radio").map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent);
    expect(names).toEqual([
      "Submit for review(1 of 2 can take it)",
      "Approve(1 of 2 can take it)",
      "Reject(2 of 2 can take it)",
      "Withdraw(1 of 2 can take it)",
    ]);
    expect(screen.queryByRole("radio", { name: /^Reopen/ })).not.toBeInTheDocument();
  });

  it("leaves destructive, incomplete, unusable and wrong-state scenarios out by default, with a count of each reason", async () => {
    serve(MIXED);
    await openPanel();
    choose("Approve");
    expect(screen.getByTestId("batch-summary")).toHaveTextContent("Approve will be sent for 3 scenarios of 7.");
    const reasons = within(screen.getByTestId("batch-exclusions")).getAllByRole("listitem").map((item) => item.textContent);
    expect(reasons).toEqual([
      "1 not allowed from their current review state.",
      "1 cannot be checked against a current specification (stale, orphaned, or no specification loaded).",
      "1 destructive, not included. Tick the destructive option to include them.",
      "1 incomplete, not included. Tick the incomplete option to include them.",
    ]);
  });

  it("lists the exact set before anything is sent", async () => {
    serve(MIXED);
    await openPanel();
    choose("Approve");
    const rows = screen.getAllByTestId("batch-set-row");
    expect(rows.map((row) => within(row).getAllByRole("rowheader")[0].textContent)).toEqual(["Scenario ok-1", "Scenario ok-2", "Scenario ok-3"]);
    expect(screen.getByText("List the 3 scenarios this will be sent for")).toBeInTheDocument();
    expect(reviewScenarios).not.toHaveBeenCalled();
  });

  it("sends an explicit list of id and version pairs, never a filter, and reports each outcome", async () => {
    serve(MIXED);
    reviewScenarios.mockResolvedValue({
      ok: true,
      data: {
        applied: [
          { id: "ok-1", version: 2, applied: true, reviewState: "approved" },
          { id: "ok-2", version: 2, applied: true, reviewState: "approved" },
        ],
        refused: [{ id: "ok-3", version: 2, applied: false, reasonCode: "stale_version", message: "The scenario is at version 3, not 2." }],
      },
    });
    const onReviewed = await openPanel(vi.fn(), { severity: "high" });
    choose("Approve");
    fireEvent.click(applyButton(/^Approve: 3 scenarios$/));
    await waitFor(() => expect(onReviewed).toHaveBeenCalledTimes(1));
    expect(reviewScenarios).toHaveBeenCalledTimes(1);
    const body = reviewScenarios.mock.calls[0][0];
    expect(body).toEqual({
      action: "approve",
      items: [
        { id: "ok-1", version: 2 },
        { id: "ok-2", version: 2 },
        { id: "ok-3", version: 2 },
      ],
    });
    expect(body).not.toHaveProperty("filter");
    expect(body).not.toHaveProperty("destructiveConfirmations");
    const report = onReviewed.mock.calls[0][0];
    expect(report.applied).toHaveLength(2);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0].message).toBe("The scenario is at version 3, not 2.");
    expect(report.titles).toEqual({ "ok-1": "Scenario ok-1", "ok-2": "Scenario ok-2", "ok-3": "Scenario ok-3" });
  });

  it("includes incomplete scenarios only when chosen", async () => {
    serve(MIXED);
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [], refused: [] } });
    await openPanel();
    choose("Approve");
    fireEvent.click(screen.getByLabelText(/Include incomplete scenarios/));
    expect(screen.getByTestId("batch-summary")).toHaveTextContent("Approve will be sent for 4 scenarios of 7.");
    fireEvent.click(applyButton(/^Approve: 4 scenarios$/));
    await waitFor(() => expect(reviewScenarios).toHaveBeenCalled());
    expect(reviewScenarios.mock.calls[0][0].items.map((item) => item.id)).toEqual(["ok-1", "ok-2", "ok-3", "incomplete"]);
  });

  it("asks for a separate confirmation naming each destructive scenario, sends nothing until it is given, and sends their ids when it is", async () => {
    serve(MIXED);
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [], refused: [] } });
    await openPanel();
    choose("Approve");
    fireEvent.click(screen.getByLabelText(/Include destructive scenarios/));
    expect(screen.getByTestId("batch-summary")).toHaveTextContent("Approve will be sent for 4 scenarios of 7.");
    fireEvent.click(applyButton(/^Approve: 4 scenarios$/));

    const dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).getByText("This batch includes 1 destructive scenario. Confirm it by name.")).toBeInTheDocument();
    const named = within(dialog).getByTestId("destructive-confirmation-list");
    expect(named).toHaveTextContent("Scenario destructive");
    expect(named).toHaveTextContent("DELETE /orders/{id}");
    expect(named).not.toHaveTextContent("Scenario ok-1");
    expect(dialog).toHaveTextContent("The other 3 in the batch are not destructive.");
    expect(reviewScenarios).not.toHaveBeenCalled();

    // Cancelling sends nothing.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(reviewScenarios).not.toHaveBeenCalled();

    fireEvent.click(applyButton(/^Approve: 4 scenarios$/));
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: "Approve destructive (1)" }));
    await waitFor(() => expect(reviewScenarios).toHaveBeenCalledTimes(1));
    expect(reviewScenarios.mock.calls[0][0]).toMatchObject({ action: "approve", destructiveConfirmations: ["destructive"] });
    expect(reviewScenarios.mock.calls[0][0].items.map((item) => item.id)).toEqual(["ok-1", "ok-2", "ok-3", "destructive"]);
  });

  it("does not ask for a destructive confirmation when no destructive scenario is in the batch", async () => {
    serve(MIXED);
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [], refused: [] } });
    await openPanel();
    choose("Approve");
    fireEvent.click(applyButton(/^Approve: 3 scenarios$/));
    await waitFor(() => expect(reviewScenarios).toHaveBeenCalled());
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
  });

  it("needs a reason to reject, says so, and sends it for every scenario", async () => {
    serve([inReview("a"), inReview("b")]);
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [], refused: [] } });
    await openPanel();
    choose("Reject");
    const button = applyButton(/^Reject: 2 scenarios$/);
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Rejecting needs a reason.");
    fireEvent.change(screen.getByLabelText(/Reason for rejecting/), { target: { value: "  Out of scope  " } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(reviewScenarios).toHaveBeenCalled());
    expect(reviewScenarios.mock.calls[0][0]).toMatchObject({ action: "reject", reason: "Out of scope" });
  });

  it("disables the action with the reason when nothing can be sent", async () => {
    serve([inReview("only", { flags: { ...NO_FLAGS, orphaned: true } })]);
    await openPanel();
    choose("Approve");
    const button = screen.getByRole("button", { name: "Approve: 0 scenarios" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Nothing in this set can be sent for this action with the current choices.");
  });

  it("shows a failed request as an error and reports no outcome", async () => {
    serve([inReview("a")]);
    reviewScenarios.mockResolvedValue({ ok: false, error: "invalid_request", message: "'items' must be a list of 1 to 5000 pairs.", status: 400, details: {} });
    const onReviewed = await openPanel();
    choose("Approve");
    fireEvent.click(applyButton(/^Approve: 1 scenario$/));
    expect(await screen.findByTestId("batch-error")).toHaveTextContent("'items' must be a list of 1 to 5000 pairs.");
    expect(onReviewed).not.toHaveBeenCalled();
  });

  it("refuses to offer an action when the set changed while its scenarios were being read", async () => {
    listScenarioIds.mockResolvedValue({ ok: true, data: { items: [{ id: "a", version: 1 }, { id: "gone", version: 1 }], total: 2, capped: false } });
    listAllScenarios.mockResolvedValue({ ok: true, data: [inReview("a")] });
    renderActive(<BatchReviewBar filters={{}} refreshToken={0} onReviewed={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /as a batch/ }));
    expect(await screen.findByTestId("batch-set-changed")).toHaveTextContent("1 of the 2 scenarios could not be read, so no action is offered on part of the set.");
    expect(screen.queryByTestId("batch-panel")).not.toBeInTheDocument();
  });

  it("shows an unreadable set as an error with a retry", async () => {
    listScenarioIds.mockResolvedValue({ ok: true, data: { items: [{ id: "a", version: 1 }], total: 1, capped: false } });
    listAllScenarios.mockResolvedValueOnce({ ok: false, error: "internal_error", message: "Something failed on the server.", status: 500, details: {} });
    renderActive(<BatchReviewBar filters={{}} refreshToken={0} onReviewed={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /as a batch/ }));
    expect(await screen.findByTestId("batch-set-error")).toHaveTextContent("Something failed on the server.");
    listAllScenarios.mockResolvedValueOnce({ ok: true, data: [inReview("a")] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("batch-panel")).toBeInTheDocument();
  });

  it("reads the set again when told a change was made", async () => {
    serve([inReview("a")]);
    const view = renderActive(<BatchReviewBar filters={{}} refreshToken={0} onReviewed={vi.fn()} />);
    await screen.findByTestId("batch-count");
    expect(listScenarioIds).toHaveBeenCalledTimes(1);
    serve([inReview("a"), inReview("b")]);
    view.rerender(
      <ActiveViewContext.Provider value="security">
        <BatchReviewBar filters={{}} refreshToken={1} onReviewed={vi.fn()} />
      </ActiveViewContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("batch-count")).toHaveTextContent("2 scenarios match"));
  });

  it("is operable by keyboard: the toggle, the actions and the options are native controls", async () => {
    serve(MIXED);
    await openPanel();
    const toggle = screen.getByRole("button", { name: "Hide batch review" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Action for this set" })).toBeInTheDocument();
    for (const control of [screen.getAllByRole("radio")[0], screen.getByLabelText(/Include destructive scenarios/), screen.getByLabelText(/Include incomplete scenarios/)]) {
      control.focus();
      expect(control).toHaveFocus();
    }
  });
});
