import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewOutcomes, type ReviewReport } from "../../../src/components/securityLab/ReviewOutcomes";
import { ScenarioReviewActions } from "../../../src/components/securityLab/ScenarioReviewActions";
import * as client from "../../../src/services/securityLabClient";
import { NO_FLAGS, scenarioItem } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  reviewScenarios: vi.fn(),
}));

const reviewScenarios = vi.mocked(client.reviewScenarios);
beforeEach(() => reviewScenarios.mockReset());

const applied = (id: string, reviewState: "in_review" | "approved" | "rejected" | "draft") => ({ id, version: 1, applied: true, reviewState });

describe("ScenarioReviewActions (FR-028, FR-033)", () => {
  it.each([
    ["draft", ["Submit for review", "Reject"]],
    ["in_review", ["Approve", "Reject", "Withdraw"]],
    ["approved", ["Reject", "Withdraw"]],
    ["rejected", ["Reopen"]],
  ] as const)("offers only what a %s scenario allows", (reviewState, labels) => {
    render(<ScenarioReviewActions scenario={scenarioItem({ reviewState })} onReviewed={vi.fn()} />);
    expect(within(screen.getByRole("group", { name: "Review actions" })).getAllByRole("button").map((button) => button.textContent)).toEqual(labels);
  });

  it("applies an action to this one scenario at the version shown and reports the outcome", async () => {
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [applied("ss-1", "in_review")], refused: [] } });
    const onReviewed = vi.fn();
    render(<ScenarioReviewActions scenario={scenarioItem({ id: "ss-1", currentVersion: 4, title: "T" })} onReviewed={onReviewed} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() => expect(onReviewed).toHaveBeenCalled());
    expect(reviewScenarios).toHaveBeenCalledWith({ action: "submit", items: [{ id: "ss-1", version: 4 }] });
    expect(onReviewed.mock.calls[0][0]).toMatchObject({ action: "submit", titles: { "ss-1": "T" } });
  });

  it("disables approve and submit with the reason when the scenario cannot be checked against a specification, but not reject or withdraw", () => {
    render(
      <ScenarioReviewActions scenario={scenarioItem({ reviewState: "in_review", flags: { ...NO_FLAGS, specificationNotLoaded: true } })} onReviewed={vi.fn()} />,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription(/Approve is unavailable: No specification is loaded/);
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  });

  it("explains a stale scenario's blocked approval in words", () => {
    render(<ScenarioReviewActions scenario={scenarioItem({ reviewState: "draft", flags: { ...NO_FLAGS, stale: true } })} onReviewed={vi.fn()} />);
    expect(screen.getByTestId("review-action-reasons")).toHaveTextContent("Submit for review is unavailable: The operation changed since this scenario was generated. Regenerate it first.");
  });

  it("asks for a reason to reject and sends it; cancelling sends nothing", async () => {
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [applied("ss-1", "rejected")], refused: [] } });
    render(<ScenarioReviewActions scenario={scenarioItem({ id: "ss-1", reviewState: "draft" })} onReviewed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    let dialog = await screen.findByTestId("confirm-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(reviewScenarios).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    dialog = await screen.findByTestId("confirm-dialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject (1)" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason for rejecting (required)"), { target: { value: " Not relevant " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(reviewScenarios).toHaveBeenCalled());
    expect(reviewScenarios).toHaveBeenCalledWith({ action: "reject", items: [{ id: "ss-1", version: 1 }], reason: "Not relevant" });
  });

  it("asks to confirm a destructive approval by name, and sends the scenario's id as the confirmation", async () => {
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [applied("ss-9", "approved")], refused: [] } });
    render(<ScenarioReviewActions scenario={scenarioItem({ id: "ss-9", title: "Delete an order", operationKey: "DELETE /orders/{id}", destructive: true, reviewState: "in_review" })} onReviewed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = await screen.findByTestId("confirm-dialog");
    expect(dialog).toHaveTextContent('Approve the destructive scenario "Delete an order"?');
    expect(dialog).toHaveTextContent("DELETE /orders/{id}");
    expect(dialog).toHaveTextContent("may change or delete data on the target");
    expect(reviewScenarios).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve destructive scenario (1)" }));
    await waitFor(() => expect(reviewScenarios).toHaveBeenCalled());
    expect(reviewScenarios).toHaveBeenCalledWith({ action: "approve", items: [{ id: "ss-9", version: 1 }], destructiveConfirmations: ["ss-9"] });
  });

  it("approves a scenario that is not destructive directly, with no destructive confirmation", async () => {
    reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [applied("ss-1", "approved")], refused: [] } });
    render(<ScenarioReviewActions scenario={scenarioItem({ id: "ss-1", reviewState: "in_review" })} onReviewed={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(reviewScenarios).toHaveBeenCalled());
    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(reviewScenarios.mock.calls[0][0]).not.toHaveProperty("destructiveConfirmations");
  });

  it("shows a failed request as an error and reports no outcome", async () => {
    reviewScenarios.mockResolvedValue({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    const onReviewed = vi.fn();
    render(<ScenarioReviewActions scenario={scenarioItem({ reviewState: "draft" })} onReviewed={onReviewed} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByTestId("review-action-error")).toHaveTextContent("The Security Lab service is unreachable.");
    expect(onReviewed).not.toHaveBeenCalled();
  });
});

describe("ReviewOutcomes (FR-031)", () => {
  const report: ReviewReport = {
    action: "approve",
    applied: [applied("a", "approved"), applied("b", "approved")],
    refused: [
      { id: "c", version: 1, applied: false, reasonCode: "destructive_confirmation_required", message: "This scenario may change or delete data. Confirm it by name to approve it." },
      { id: "d", version: 1, applied: false, reasonCode: "stale_version", message: "The scenario is at version 2, not 1." },
    ],
    titles: { a: "Alpha", b: "Beta", c: "Gamma", d: "Delta" },
  };

  it("announces a partial application as one, in a status message", () => {
    render(<ReviewOutcomes report={report} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 of 4 scenarios were approved; 2 were refused.");
  });

  it("lists each refused scenario by title with its result as text and the server's reason", () => {
    render(<ReviewOutcomes report={report} onDismiss={vi.fn()} />);
    const rows = screen.getAllByTestId("review-outcome-row").filter((row) => row.getAttribute("data-result") === "refused");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Gamma")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Refused: Needs destructive confirmation")).toBeInTheDocument();
    expect(within(rows[0]).getByText("This scenario may change or delete data. Confirm it by name to approve it.")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Refused: Version changed")).toBeInTheDocument();
  });

  it("lists the applied scenarios with their new state", () => {
    render(<ReviewOutcomes report={report} onDismiss={vi.fn()} />);
    const rows = screen.getAllByTestId("review-outcome-row").filter((row) => row.getAttribute("data-result") === "applied");
    expect(rows.map((row) => within(row).getAllByRole("rowheader")[0].textContent)).toEqual(["Alpha", "Beta"]);
    expect(within(rows[0]).getByText("Applied")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Now approved.")).toBeInTheDocument();
  });

  it("falls back to the id when no title is known, and can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<ReviewOutcomes report={{ ...report, titles: {} }} onDismiss={onDismiss} />);
    expect(screen.getAllByText("c").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss outcome" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("states a batch in which nothing was applied as refused, not as done", () => {
    render(<ReviewOutcomes report={{ ...report, applied: [] }} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("None of the 2 scenarios were approved; all were refused.");
    expect(screen.queryByText(/^Applied to/)).not.toBeInTheDocument();
  });
});
