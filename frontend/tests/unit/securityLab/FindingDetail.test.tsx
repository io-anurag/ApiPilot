import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { EvidenceView } from "../../../src/components/securityLab/EvidenceView";
import { FindingDetail } from "../../../src/components/securityLab/FindingDetail";
import * as client from "../../../src/services/securityLabClient";
import { evidenceRecord, finding, findingOccurrence } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  patchFinding: vi.fn(),
  fetchFindingEvidence: vi.fn(),
}));

const patchFinding = vi.mocked(client.patchFinding);
const fetchFindingEvidence = vi.mocked(client.fetchFindingEvidence);

function renderActive(ui: ReactElement) {
  return render(<ActiveViewContext.Provider value="security">{ui}</ActiveViewContext.Provider>);
}

function renderDetail(f = finding()) {
  const handlers = { onChanged: vi.fn(), onOpenScenario: vi.fn(), onOpenRun: vi.fn(), onOpenFinding: vi.fn() };
  renderActive(<FindingDetail finding={f} categoryName="Authentication" headingId="h" {...handlers} />);
  return handlers;
}

beforeEach(() => {
  patchFinding.mockReset();
  fetchFindingEvidence.mockReset();
});

describe("FindingDetail (T123, FR-054 to FR-059)", () => {
  it("names the finding, shows severity and status as text, and the occurrence count", () => {
    renderDetail(finding({ severity: { suggested: "high", current: "critical" }, status: "accepted-risk", occurrenceCount: 4 }));
    expect(screen.getByRole("heading", { level: 3, name: "GET /orders: Authentication" })).toBeInTheDocument();
    const article = screen.getByTestId("finding-detail");
    expect(within(article).getByText("Severity: Critical")).toBeInTheDocument();
    expect(within(article).getByText("Status: Accepted risk")).toBeInTheDocument();
    expect(within(article).getByText("4 occurrences")).toBeInTheDocument();
    expect(screen.getByTestId("status-explanation")).toHaveTextContent("You decided to accept this risk. A new occurrence is flagged for your review, never hidden.");
    expect(screen.getByTestId("status-explanation")).toHaveTextContent("Suggested severity was high; you changed it.");
  });

  it("shows what was expected beside what was observed, as a sentence and never a body", () => {
    renderDetail();
    const pair = screen.getByTestId("expected-observed");
    expect(pair).toHaveTextContent("The operation rejects a request with no credentials.");
    expect(pair).toHaveTextContent("Documented in the specification");
    expect(pair).toHaveTextContent("Status 200. The operation answered 200 to a request with no credentials.");
    expect(pair).toHaveTextContent("The response body is not kept here.");
  });

  it("shows a named product rule as the basis when the expectation is not documented", () => {
    renderDetail(finding({ expected: { kind: "rejected", statement: "x", basis: "product-rule", ruleId: "authentication.omit-credentials" } }));
    expect(screen.getByTestId("expected-observed")).toHaveTextContent("Product rule");
    expect(screen.getByTestId("expected-observed")).toHaveTextContent("authentication.omit-credentials");
  });

  it("lists every occurrence with its time, its confidence and the basis of that confidence", () => {
    renderDetail(
      finding({
        occurrences: [
          findingOccurrence({ resultId: "r1", at: "2026-10-18T10:00:05.000Z", confidence: { level: "high", basis: "The status contradicted the documented 401." } }),
          findingOccurrence({ resultId: "r2", at: "2026-10-19T08:30:00.000Z", confidence: { level: "low", basis: "Only a header was inspected." } }),
        ],
      }),
    );
    const rows = screen.getAllByTestId("occurrence-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("2026-10-18 10:00 UTC")).toBeInTheDocument();
    expect(within(rows[0]).getByText("High confidence")).toBeInTheDocument();
    expect(within(rows[0]).getByText("The status contradicted the documented 401.")).toBeInTheDocument();
    expect(within(rows[1]).getByText("2026-10-19 08:30 UTC")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Low confidence")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Only a header was inspected.")).toBeInTheDocument();
  });

  it("shows the remediation as general guidance", () => {
    renderDetail();
    expect(screen.getByTestId("remediation")).toHaveTextContent("Require a valid credential on this operation and return 401 when it is missing.");
    expect(screen.getByText(/It is general advice for this kind of finding, not a statement about your code\./)).toBeInTheDocument();
  });

  it("links to the scenario version, the run and the specification element", () => {
    const { onOpenScenario, onOpenRun } = renderDetail(finding({ scenarioId: "ss-9", scenarioVersion: 3, occurrences: [findingOccurrence({ runId: "run-7" })] }));
    fireEvent.click(screen.getByRole("button", { name: "Open the scenario" }));
    expect(onOpenScenario).toHaveBeenCalledWith("ss-9", 3);
    expect(screen.getByText(/Scenario version 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open the run of the occurrence at 2026-10-18 10:00 UTC" }));
    expect(onOpenRun).toHaveBeenCalledWith("run-7");
    expect(screen.getByText("/operations/GET /orders/security")).toBeInTheDocument();
    expect(screen.getByText("API2")).toBeInTheDocument();
  });

  it("says which earlier finding it supersedes, and opens it", () => {
    const { onOpenFinding } = renderDetail(finding({ supersedes: "sf-earlier" }));
    expect(screen.getByTestId("supersedes")).toHaveTextContent("Supersedes the finding for an earlier version of this scenario");
    fireEvent.click(screen.getByRole("button", { name: "Open the earlier finding" }));
    expect(onOpenFinding).toHaveBeenCalledWith("sf-earlier");
  });

  it("has no supersedes line for a finding that supersedes nothing", () => {
    renderDetail();
    expect(screen.queryByTestId("supersedes")).not.toBeInTheDocument();
  });

  it("shows the history, and says so when there is none", () => {
    renderDetail(finding({ history: [{ at: "2026-10-18T11:00:00.000Z", field: "status", from: "open", to: "accepted-risk", note: "Tracked in the backlog", actor: "user" }] }));
    const row = screen.getByTestId("history-row");
    expect(row).toHaveTextContent("2026-10-18 11:00 UTC");
    expect(row).toHaveTextContent("status: open to accepted-risk");
    expect(row).toHaveTextContent("Tracked in the backlog");
  });

  it("says no change has been made when the history is empty", () => {
    renderDetail();
    expect(screen.getByText("No change has been made to this finding.")).toBeInTheDocument();
  });

  it("says a resolved finding is not verified until a later run passes", () => {
    renderDetail(finding({ status: "resolved" }));
    expect(screen.getByTestId("resolved-assertion")).toHaveTextContent("has not been verified");
  });

  describe("raw evidence", () => {
    it("says raw evidence is no longer available when the occurrence's session has ended, with no way to open it", () => {
      renderDetail(finding({ occurrences: [findingOccurrence({ evidenceAvailable: false })] }));
      const row = screen.getByTestId("occurrence-row");
      expect(row).toHaveTextContent("Raw evidence is no longer available: the session that held it has ended.");
      expect(within(row).queryByRole("button", { name: /View the evidence/ })).not.toBeInTheDocument();
    });

    it("opens the redacted evidence of an occurrence in a scrolling code block, and closes it", async () => {
      fetchFindingEvidence.mockResolvedValue({ ok: true, data: { available: true, records: [evidenceRecord()] } });
      renderDetail(finding({ occurrences: [findingOccurrence({ resultId: "res-9" })] }));
      fireEvent.click(screen.getByRole("button", { name: "View the evidence of the occurrence at 2026-10-18 10:00 UTC" }));
      const view = await screen.findByTestId("evidence-view");
      expect(fetchFindingEvidence).toHaveBeenCalledWith("sf-0000000000000001", "res-9", expect.anything());
      const block = await within(view).findByTestId("code-block");
      expect(block.textContent).toContain("GET https://api.example.test/orders");
      expect(block.textContent).toContain("Authorization: [redacted]");
      expect(block.className).toContain("overflow-auto");
      fireEvent.click(within(view).getByRole("button", { name: "Close evidence" }));
      expect(screen.queryByTestId("evidence-view")).not.toBeInTheDocument();
    });
  });

  describe("changing status or severity", () => {
    it("offers only the statuses the server accepts, and not the current severity", () => {
      renderDetail();
      expect(within(screen.getByLabelText(/New status/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["Keep the status", "Accepted risk", "False positive", "Resolved"]);
      expect(within(screen.getByLabelText(/New severity/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["Keep the severity", "Info", "Low", "Medium", "Critical"]);
    });

    it("offers only open for a finding that already has another status", () => {
      renderDetail(finding({ status: "false-positive" }));
      expect(within(screen.getByLabelText(/New status/)).getAllByRole("option").map((o) => o.textContent)).toEqual(["Keep the status", "Open"]);
    });

    it("disables Save with the reason until something changes and a note is written", () => {
      renderDetail();
      const save = screen.getByRole("button", { name: "Save change" });
      expect(save).toBeDisabled();
      expect(save).toHaveAccessibleDescription("Choose a new status or a new severity.");
      fireEvent.change(screen.getByLabelText(/New status/), { target: { value: "resolved" } });
      expect(save).toBeDisabled();
      expect(save).toHaveAccessibleDescription(/Write a note saying why/);
      fireEvent.change(screen.getByLabelText(/^Note: why/), { target: { value: "Fixed in release 4.2" } });
      expect(save).toBeEnabled();
    });

    it("sends the change with its note, then clears the form and reports the update", async () => {
      const updated = finding({ status: "resolved" });
      patchFinding.mockResolvedValue({ ok: true, data: updated });
      const { onChanged } = renderDetail();
      fireEvent.change(screen.getByLabelText(/New status/), { target: { value: "resolved" } });
      fireEvent.change(screen.getByLabelText(/New severity/), { target: { value: "low" } });
      fireEvent.change(screen.getByLabelText(/^Note: why/), { target: { value: "  Fixed in 4.2  " } });
      fireEvent.click(screen.getByRole("button", { name: "Save change" }));
      await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
      expect(patchFinding).toHaveBeenCalledWith("sf-0000000000000001", { status: "resolved", severity: "low", note: "Fixed in 4.2" });
      expect(screen.getByLabelText(/New status/)).toHaveValue("");
      expect(screen.getByLabelText(/^Note: why/)).toHaveValue("");
    });

    it("shows a refused change with the server's reason and keeps what was typed", async () => {
      patchFinding.mockResolvedValue({ ok: false, error: "invalid_finding_update", message: "A status change needs a note saying why.", status: 422, details: {} });
      const { onChanged } = renderDetail();
      fireEvent.change(screen.getByLabelText(/New status/), { target: { value: "resolved" } });
      fireEvent.change(screen.getByLabelText(/^Note: why/), { target: { value: "x" } });
      fireEvent.click(screen.getByRole("button", { name: "Save change" }));
      expect(await screen.findByTestId("finding-update-error")).toHaveTextContent("A status change needs a note saying why.");
      expect(onChanged).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/New status/)).toHaveValue("resolved");
    });
  });

  describe("unreviewed occurrences", () => {
    it("shows a visible marker and an acknowledge action for a finding with an unreviewed occurrence", async () => {
      const updated = finding({ status: "accepted-risk", unreviewedOccurrence: false });
      patchFinding.mockResolvedValue({ ok: true, data: updated });
      const { onChanged } = renderDetail(finding({ status: "accepted-risk", unreviewedOccurrence: true }));
      const banner = screen.getByTestId("unreviewed-banner");
      expect(banner).toHaveTextContent("A new occurrence has not been reviewed");
      expect(screen.getAllByText("Unreviewed occurrence").length).toBeGreaterThan(0);
      fireEvent.click(within(banner).getByRole("button", { name: "Acknowledge the new occurrence" }));
      await waitFor(() => expect(onChanged).toHaveBeenCalledWith(updated));
      expect(patchFinding).toHaveBeenCalledWith("sf-0000000000000001", { acknowledgeOccurrences: true });
    });

    it("shows neither the marker nor the action when every occurrence has been reviewed", () => {
      renderDetail();
      expect(screen.queryByTestId("unreviewed-banner")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Acknowledge the new occurrence" })).not.toBeInTheDocument();
    });
  });
});

describe("EvidenceView (T123, FR-057)", () => {
  it("says raw evidence is no longer available once its session has ended", async () => {
    fetchFindingEvidence.mockResolvedValue({ ok: true, data: { available: false, records: [] } });
    renderActive(<EvidenceView findingId="f" resultId="r" onClose={vi.fn()} />);
    expect(await screen.findByTestId("evidence-unavailable")).toHaveTextContent("Raw evidence is no longer available: the session that held it has ended. The observed summary of this occurrence is kept.");
  });

  it("shows a loading state, then each request as its own scrolling block", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.fetchFindingEvidence>>) => void;
    fetchFindingEvidence.mockReturnValue(new Promise((r) => (resolve = r)));
    renderActive(<EvidenceView findingId="f" resultId="r" onClose={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Loading the evidence" })).toBeInTheDocument();
    resolve({ ok: true, data: { available: true, records: [evidenceRecord({ index: 0 }), evidenceRecord({ index: 1, method: "POST", urlRedacted: "https://api.example.test/orders?token=[redacted]" })] } });
    const blocks = await screen.findAllByTestId("code-block");
    expect(blocks).toHaveLength(2);
    expect(screen.getByText("Request 2 of 2: POST https://api.example.test/orders?token=[redacted]")).toBeInTheDocument();
    expect(screen.getByText("Secrets in these requests and responses were redacted before they were stored.")).toBeInTheDocument();
  });

  it("shows an unreadable evidence list as an error with a retry, not as no evidence", async () => {
    fetchFindingEvidence.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderActive(<EvidenceView findingId="f" resultId="r" onClose={vi.fn()} />);
    const error = await screen.findByTestId("evidence-error");
    expect(error).toHaveTextContent("This is not the same as no evidence.");
    expect(screen.queryByTestId("evidence-unavailable")).not.toBeInTheDocument();
    fetchFindingEvidence.mockResolvedValueOnce({ ok: true, data: { available: true, records: [evidenceRecord()] } });
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("code-block")).toBeInTheDocument();
  });
});
