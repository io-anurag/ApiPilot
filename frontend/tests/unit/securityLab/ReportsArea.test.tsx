import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ReportsArea } from "../../../src/components/securityLab/ReportsArea";
import { DELETE_ALL_PHRASE, RETENTION_COOKIE_LIMITATION, RetainedDataPanel } from "../../../src/components/securityLab/RetainedDataPanel";
import * as saveBlobModule from "../../../src/components/securityLab/saveBlob";
import * as client from "../../../src/services/securityLabClient";
import { overview, retainedData, runView, securityReport } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchReport: vi.fn(),
  downloadReport: vi.fn(),
  listRuns: vi.fn(),
  fetchRetainedData: vi.fn(),
  deleteAssessment: vi.fn(),
  deleteAllRetainedData: vi.fn(),
}));
vi.mock("../../../src/components/securityLab/saveBlob", () => ({ saveBlob: vi.fn() }));

const fetchReport = vi.mocked(client.fetchReport);
const downloadReport = vi.mocked(client.downloadReport);
const listRuns = vi.mocked(client.listRuns);
const fetchRetainedData = vi.mocked(client.fetchRetainedData);
const deleteAssessment = vi.mocked(client.deleteAssessment);
const deleteAllRetainedData = vi.mocked(client.deleteAllRetainedData);
const saveBlob = vi.mocked(saveBlobModule.saveBlob);

function renderActive(ui: ReactElement) {
  return render(<ActiveViewContext.Provider value="security">{ui}</ActiveViewContext.Provider>);
}

const NOTHING = { ok: false as const, error: "nothing_to_report", message: "There is nothing to report yet. Generate scenarios, run them, or analyze a specification first.", status: 409, details: {} };

beforeEach(() => {
  for (const mock of [fetchReport, downloadReport, listRuns, fetchRetainedData, deleteAssessment, deleteAllRetainedData, saveBlob]) mock.mockReset();
  fetchReport.mockResolvedValue({ ok: true, data: securityReport() });
  listRuns.mockResolvedValue({ ok: true, data: { runs: [runView({ id: "run-1", status: "completed" }), runView({ id: "run-2", status: "cancelled", startedAt: "2026-10-17T08:00:00.000Z" })] } });
  fetchRetainedData.mockResolvedValue({ ok: true, data: retainedData() });
});

describe("ReportsArea (T128, T134, FR-061, FR-062)", () => {
  it("shows a loading state while the report is built, then the report", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.fetchReport>>) => void;
    fetchReport.mockReturnValue(new Promise((r) => (resolve = r)));
    renderActive(<ReportsArea />);
    expect(screen.getByRole("status", { name: "Building the report" })).toBeInTheDocument();
    expect(screen.queryByTestId("report-nothing")).not.toBeInTheDocument();
    resolve({ ok: true, data: securityReport() });
    expect(await screen.findByTestId("report-body")).toBeInTheDocument();
  });

  it("shows the assessment summary", async () => {
    renderActive(<ReportsArea />);
    const summary = await screen.findByTestId("report-summary");
    expect(summary).toHaveTextContent("Assessment: Orders API · orders.yaml");
    expect(summary).toHaveTextContent("Generated: 2026-10-18 12:00 UTC");
    expect(summary).toHaveTextContent("Specification: loaded, revision aaaaaaaaaaaa");
    expect(summary).toHaveTextContent("Taxonomy: owasp-api-top10-2023");
    expect(summary).toHaveTextContent("Scenarios: 12 (Draft 7, In review 2, Approved 3, Rejected 0)");
    expect(summary).toHaveTextContent("Findings: 3 (Critical 0, High 2, Medium 1, Low 0, Info 0); 7 occurrences, counted separately");
  });

  it("says a report built with no specification loaded is from retained work", async () => {
    fetchReport.mockResolvedValue({ ok: true, data: securityReport({ overview: overview({ specificationLoaded: false }), specificationRevision: undefined }) });
    renderActive(<ReportsArea />);
    expect(await screen.findByTestId("report-summary")).toHaveTextContent("Specification: not loaded: this report is built from retained work");
  });

  it("shows category coverage with the outcomes of each category, and what is not covered", async () => {
    renderActive(<ReportsArea />);
    const rows = await screen.findAllByTestId("coverage-row");
    expect(rows).toHaveLength(2);
    const table = screen.getByRole("table", { name: /Each category/ });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Category", "Support level", "Scenarios", "Passed", "Failed", "Inconclusive", "Blocked", "Errored", "Not run"]);
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Supported", "8", "2", "1", "0", "1", "0", "4"]);
    expect(within(rows[1]).getByText("Analysis only")).toBeInTheDocument();
    expect(screen.getByTestId("not-covered")).toHaveTextContent("API inventory: This category is analysis only and cannot be run.");
    expect(screen.getByText("Blocked, errored and not run are not passes.")).toBeInTheDocument();
  });

  it("shows findings with severity, status, occurrences and remediation status, and not as proof of anything when there are none", async () => {
    renderActive(<ReportsArea />);
    const row = await screen.findByTestId("report-finding-row");
    expect(within(row).getByText("GET /orders: Authentication")).toBeInTheDocument();
    expect(within(row).getByText("High")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("1 occurrence")).toBeInTheDocument();
    expect(within(row).getByText(/Require a valid credential/)).toBeInTheDocument();
    expect(screen.getByTestId("report-finding-status-counts")).toHaveTextContent("Open 2, Accepted risk 1, False positive 0, Resolved 0");
  });

  it("says an empty findings section is not proof that the API is secure", async () => {
    fetchReport.mockResolvedValue({ ok: true, data: securityReport({ findings: [] }) });
    renderActive(<ReportsArea />);
    expect(await screen.findByTestId("report-no-findings")).toHaveTextContent("That is not proof that the API is secure.");
  });

  it("lists the runs included, and says plainly when none is", async () => {
    renderActive(<ReportsArea />);
    const row = await screen.findByTestId("report-run-row");
    expect(row).toHaveTextContent("2026-10-18 10:00 UTC");
    expect(row).toHaveTextContent("Staging run");
    expect(row).toHaveTextContent("https://api.example.test");
    expect(within(row).getByText("Completed")).toBeInTheDocument();
  });

  it("says no run is included when the report has none", async () => {
    fetchReport.mockResolvedValue({ ok: true, data: securityReport({ runs: [] }) });
    renderActive(<ReportsArea />);
    expect(await screen.findByTestId("report-no-runs")).toHaveTextContent("nothing in this report has been sent to a target");
  });

  it("states the limits of the assessment, using the report's own statement", async () => {
    renderActive(<ReportsArea />);
    expect(await screen.findByTestId("report-limits")).toHaveTextContent("This assessment covers only the scenarios that were run, against the target and at the time shown. It does not prove the API is secure.");
  });

  describe("states", () => {
    it("shows nothing to report as its own state, with the server's message, and disables the downloads with the reason", async () => {
      fetchReport.mockResolvedValue(NOTHING);
      renderActive(<ReportsArea />);
      const empty = await screen.findByTestId("report-nothing");
      expect(empty).toHaveTextContent("There is nothing to report yet.");
      expect(empty).toHaveTextContent("Generate scenarios, run them, or analyze a specification first.");
      expect(screen.queryByTestId("report-error")).not.toBeInTheDocument();
      const html = screen.getByRole("button", { name: "Download HTML report" });
      expect(html).toBeDisabled();
      expect(html).toHaveAccessibleDescription("There is nothing to report yet, so there is nothing to download.");
      expect(screen.getByRole("button", { name: "Download JSON report" })).toBeDisabled();
    });

    it("shows a report that could not be built as an error with a retry, never as an empty report", async () => {
      fetchReport.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
      renderActive(<ReportsArea />);
      const error = await screen.findByTestId("report-error");
      expect(error).toHaveTextContent("This is not the same as an empty report.");
      expect(screen.queryByTestId("report-nothing")).not.toBeInTheDocument();
      fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
      expect(await screen.findByTestId("report-body")).toBeInTheDocument();
    });
  });

  describe("run selection", () => {
    it("builds the report for every run until some are chosen, then only for those", async () => {
      renderActive(<ReportsArea />);
      await screen.findByTestId("report-body");
      expect(fetchReport).toHaveBeenLastCalledWith(undefined, expect.anything());
      const group = screen.getByRole("group", { name: /Limit the report to some runs/ });
      expect(within(group).getAllByRole("checkbox")).toHaveLength(2);
      fireEvent.click(within(group).getByLabelText(/Run started 2026-10-17 08:00 UTC/));
      await waitFor(() => expect(fetchReport).toHaveBeenLastCalledWith(["run-2"], expect.anything()));
      fireEvent.click(within(group).getByLabelText(/Run started 2026-10-18 10:00 UTC/));
      await waitFor(() => expect(fetchReport).toHaveBeenLastCalledWith(["run-1", "run-2"], expect.anything()));
      fireEvent.click(within(group).getByLabelText(/Run started 2026-10-17 08:00 UTC/));
      fireEvent.click(within(group).getByLabelText(/Run started 2026-10-18 10:00 UTC/));
      await waitFor(() => expect(fetchReport).toHaveBeenLastCalledWith(undefined, expect.anything()));
    });

    it("offers no run selection when there is no run, and still builds the report", async () => {
      listRuns.mockResolvedValue({ ok: true, data: { runs: [] } });
      renderActive(<ReportsArea />);
      await screen.findByTestId("report-body");
      expect(screen.queryByRole("group", { name: /Limit the report/ })).not.toBeInTheDocument();
    });

    it("shows an unreadable run list as an error and still builds the report for every run", async () => {
      listRuns.mockResolvedValue({ ok: false, error: "network_error", message: "gone", status: 0, details: {} });
      renderActive(<ReportsArea />);
      expect(await screen.findByTestId("report-runs-error")).toHaveTextContent("The report can still be made for every run.");
      expect(await screen.findByTestId("report-body")).toBeInTheDocument();
    });
  });

  describe("download", () => {
    it("downloads the HTML report through the client and hands the file to the browser", async () => {
      const blob = new Blob(["<html></html>"], { type: "text/html" });
      downloadReport.mockResolvedValue({ ok: true, data: { blob, fileName: "security-report-orders.html" } });
      renderActive(<ReportsArea />);
      await screen.findByTestId("report-body");
      fireEvent.click(screen.getByRole("button", { name: "Download HTML report" }));
      expect(await screen.findByTestId("report-downloaded")).toHaveTextContent("Saved security-report-orders.html.");
      expect(downloadReport).toHaveBeenCalledWith("html", undefined);
      expect(saveBlob).toHaveBeenCalledWith(blob, "security-report-orders.html");
    });

    it("downloads the JSON report for the chosen runs", async () => {
      const blob = new Blob(["{}"], { type: "application/json" });
      downloadReport.mockResolvedValue({ ok: true, data: { blob, fileName: "security-report.json" } });
      renderActive(<ReportsArea />);
      fireEvent.click(await screen.findByLabelText(/Run started 2026-10-17 08:00 UTC/));
      await waitFor(() => expect(fetchReport).toHaveBeenLastCalledWith(["run-2"], expect.anything()));
      fireEvent.click(screen.getByRole("button", { name: "Download JSON report" }));
      await waitFor(() => expect(saveBlob).toHaveBeenCalled());
      expect(downloadReport).toHaveBeenCalledWith("json", ["run-2"]);
    });

    it("shows a refused download with the server's message, saves nothing and says nothing was saved", async () => {
      downloadReport.mockResolvedValue(NOTHING);
      renderActive(<ReportsArea />);
      await screen.findByTestId("report-body");
      fireEvent.click(screen.getByRole("button", { name: "Download HTML report" }));
      expect(await screen.findByTestId("report-download-error")).toHaveTextContent("There is nothing to report yet. Generate scenarios, run them, or analyze a specification first.");
      expect(saveBlob).not.toHaveBeenCalled();
      expect(screen.queryByTestId("report-downloaded")).not.toBeInTheDocument();
    });

    it("disables both downloads while one is being prepared", async () => {
      let resolve!: (value: Awaited<ReturnType<typeof client.downloadReport>>) => void;
      downloadReport.mockReturnValue(new Promise((r) => (resolve = r)));
      renderActive(<ReportsArea />);
      await screen.findByTestId("report-body");
      fireEvent.click(screen.getByRole("button", { name: "Download HTML report" }));
      expect(await screen.findByRole("button", { name: "Preparing..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Download JSON report" })).toBeDisabled();
      resolve({ ok: true, data: { blob: new Blob(["x"]), fileName: "r.html" } });
      await waitFor(() => expect(screen.getByRole("button", { name: "Download HTML report" })).toBeEnabled());
    });
  });

  it("includes the export of approved scenarios (T145), usable with a specification and disabled with the reason without one, while the report stays downloadable", async () => {
    const { unmount } = renderActive(<ReportsArea />);
    await screen.findByTestId("report-body");
    expect(screen.getByTestId("security-export-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export approved scenarios" })).toBeEnabled();
    unmount();

    renderActive(<ReportsArea specificationLoaded={false} />);
    await screen.findByTestId("report-body");
    const exportButton = screen.getByRole("button", { name: "Export approved scenarios" });
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveAccessibleDescription(/No specification is loaded/);
    expect(screen.getByRole("button", { name: "Download HTML report" })).toBeEnabled();
  });

  it("includes the retained data panel", async () => {
    renderActive(<ReportsArea />);
    expect(await screen.findByTestId("retained-data-panel")).toBeInTheDocument();
  });

  it("reads the report again after retained data is deleted", async () => {
    deleteAllRetainedData.mockResolvedValue({ ok: true, data: {} });
    renderActive(<ReportsArea />);
    await screen.findByTestId("report-body");
    const before = fetchReport.mock.calls.length;
    fetchReport.mockResolvedValue(NOTHING);
    fireEvent.click(await screen.findByRole("button", { name: "Delete everything retained for this browser" }));
    fireEvent.change(await screen.findByLabelText(`Type ${DELETE_ALL_PHRASE}`), { target: { value: DELETE_ALL_PHRASE } });
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(await screen.findByTestId("report-nothing")).toBeInTheDocument();
    expect(fetchReport.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("RetainedDataPanel (T135, FR-051)", () => {
  it("shows what is kept and what goes with the session, using the server's text", async () => {
    renderActive(<RetainedDataPanel />);
    const kept = await screen.findByTestId("retained-list");
    expect(within(kept).getAllByRole("listitem").map((li) => li.textContent)).toEqual(retainedData().retained);
    expect(within(screen.getByTestId("removed-list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(retainedData().removedWithSession);
    expect(screen.getByRole("heading", { name: "Kept until you delete it" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Removed when the session ends" })).toBeInTheDocument();
  });

  it("states the retention-cookie limitation in full", async () => {
    renderActive(<RetainedDataPanel />);
    const text = await screen.findByTestId("retention-cookie-limitation");
    expect(text.textContent).toBe(
      "The browser's retention cookie is what links this browser to its retained work, so clearing cookies or using another browser or profile means this work can no longer be reached (it stays stored until deleted or the cap is reached).",
    );
    expect(RETENTION_COOKIE_LIMITATION).toBe(text.textContent);
  });

  it("shows each assessment's label and counts, the totals and the caps", async () => {
    renderActive(<RetainedDataPanel />);
    const rows = await screen.findAllByTestId("retained-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Orders API · orders.yaml")).toBeInTheDocument();
    expect(within(rows[0]).getAllByRole("cell").map((c) => c.textContent).slice(0, 3)).toEqual(["12", "2", "3"]);
    expect(screen.getByTestId("retained-totals")).toHaveTextContent("Retained now: 16 scenarios, 2 runs, 3 findings. Caps: up to 5000 scenarios and 500 runs");
  });

  it("says nothing is retained, as an empty state, and still offers delete everything", async () => {
    fetchRetainedData.mockResolvedValue({ ok: true, data: retainedData({ assessments: [], totals: { scenarios: 0, runs: 0, findings: 0 } }) });
    renderActive(<RetainedDataPanel />);
    expect(await screen.findByTestId("retained-empty")).toHaveTextContent("Nothing is retained for this browser.");
    expect(screen.getByRole("button", { name: "Delete everything retained for this browser" })).toBeEnabled();
  });

  it("shows unreadable retained data as an error with a retry, not as nothing retained", async () => {
    fetchRetainedData.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderActive(<RetainedDataPanel />);
    const error = await screen.findByTestId("retained-error");
    expect(error).toHaveTextContent("This is not the same as nothing being retained.");
    expect(screen.queryByTestId("retained-empty")).not.toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("retained-row")).toHaveLength(2);
  });

  it("shows a loading state", () => {
    fetchRetainedData.mockReturnValue(new Promise(() => undefined));
    renderActive(<RetainedDataPanel />);
    expect(screen.getByRole("status", { name: "Reading the retained data" })).toBeInTheDocument();
  });

  describe("deleting an assessment", () => {
    async function openDelete(label = "Orders API · orders.yaml") {
      renderActive(<RetainedDataPanel onDeleted={onDeleted} />);
      fireEvent.click(await screen.findByRole("button", { name: `Delete the retained work of ${label}` }));
      return screen.findByTestId("prompt-dialog");
    }
    const onDeleted = vi.fn();
    beforeEach(() => onDeleted.mockReset());

    it("asks for the assessment's label to be typed, saying what will be deleted, and sends nothing until it is", async () => {
      const dialog = await openDelete();
      expect(dialog).toHaveTextContent("12 scenarios, 2 runs, 3 findings");
      expect(dialog).toHaveTextContent("This cannot be undone.");
      expect(dialog).toHaveTextContent("Type the assessment label exactly to confirm: Orders API · orders.yaml");
      expect(within(dialog).getByRole("button", { name: "Delete permanently" })).toBeDisabled();
      expect(deleteAssessment).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByTestId("prompt-dialog")).not.toBeInTheDocument();
      expect(deleteAssessment).not.toHaveBeenCalled();
    });

    it("sends the typed label, then reads the data again and reports it", async () => {
      deleteAssessment.mockResolvedValue({ ok: true, data: {} });
      const dialog = await openDelete();
      fireEvent.change(within(dialog).getByLabelText("Type the assessment label"), { target: { value: "Orders API · orders.yaml" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
      await waitFor(() => expect(deleteAssessment).toHaveBeenCalledWith("k1", "Orders API · orders.yaml"));
      expect(await screen.findByTestId("retained-done")).toHaveTextContent("The retained work of “Orders API · orders.yaml” was deleted.");
      await waitFor(() => expect(fetchRetainedData).toHaveBeenCalledTimes(2));
      expect(onDeleted).toHaveBeenCalled();
    });

    it.each([
      ["confirmation_mismatch", 422, "Type the assessment's label exactly to delete it: Orders API · orders.yaml"],
      ["assessment_not_found", 404, "No retained assessment with key 'k1' was found."],
      ["execution_in_progress", 409, "A run is in progress. Cancel it or wait for it to finish before deleting."],
    ])("shows the server's refusal %s as it is, and deletes nothing", async (error, status, message) => {
      deleteAssessment.mockResolvedValue({ ok: false, error, message, status, details: {} });
      const dialog = await openDelete();
      fireEvent.change(within(dialog).getByLabelText("Type the assessment label"), { target: { value: "wrong" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
      expect(await screen.findByTestId("retained-delete-error")).toHaveTextContent(message);
      expect(screen.queryByTestId("retained-done")).not.toBeInTheDocument();
      expect(onDeleted).not.toHaveBeenCalled();
      expect(fetchRetainedData).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleting everything", () => {
    it("asks for DELETE ALL to be typed, naming what goes, and sends it", async () => {
      deleteAllRetainedData.mockResolvedValue({ ok: true, data: {} });
      renderActive(<RetainedDataPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Delete everything retained for this browser" }));
      const dialog = await screen.findByTestId("prompt-dialog");
      expect(dialog).toHaveTextContent("16 scenarios, 2 runs, 3 findings, and your profiles, credentials and evidence in this session. This cannot be undone. Type DELETE ALL to confirm.");
      expect(within(dialog).getByRole("button", { name: "Delete permanently" })).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText("Type DELETE ALL"), { target: { value: "DELETE ALL" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
      await waitFor(() => expect(deleteAllRetainedData).toHaveBeenCalledWith("DELETE ALL"));
      expect(await screen.findByTestId("retained-done")).toHaveTextContent("Everything retained for this browser was deleted.");
    });

    it("shows a refusal while a run is in progress", async () => {
      deleteAllRetainedData.mockResolvedValue({ ok: false, error: "execution_in_progress", message: "A run is in progress. Cancel it or wait for it to finish before deleting.", status: 409, details: { runId: "run-1" } });
      renderActive(<RetainedDataPanel />);
      fireEvent.click(await screen.findByRole("button", { name: "Delete everything retained for this browser" }));
      const dialog = await screen.findByTestId("prompt-dialog");
      fireEvent.change(within(dialog).getByLabelText("Type DELETE ALL"), { target: { value: "DELETE ALL" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
      expect(await screen.findByTestId("retained-delete-error")).toHaveTextContent("A run is in progress.");
    });
  });
});
