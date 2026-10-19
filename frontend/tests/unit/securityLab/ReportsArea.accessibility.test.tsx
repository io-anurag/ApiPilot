import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ReportsArea } from "../../../src/components/securityLab/ReportsArea";
import * as client from "../../../src/services/securityLabClient";
import { exportReply, retainedData, runView, securityReport } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchReport: vi.fn(),
  downloadReport: vi.fn(),
  listRuns: vi.fn(),
  fetchRetainedData: vi.fn(),
  exportSecurityPostman: vi.fn(),
}));
vi.mock("../../../src/components/securityLab/saveBlob", () => ({ saveBlob: vi.fn() }));

const m = {
  fetchReport: vi.mocked(client.fetchReport),
  downloadReport: vi.mocked(client.downloadReport),
  listRuns: vi.mocked(client.listRuns),
  fetchRetainedData: vi.mocked(client.fetchRetainedData),
  exportSecurityPostman: vi.mocked(client.exportSecurityPostman),
};

const NOTHING = { ok: false as const, error: "nothing_to_report", message: "There is nothing to report yet.", status: 409, details: {} };

function renderReports(props: { specificationLoaded?: boolean } = {}) {
  return render(
    <ActiveViewContext.Provider value="security">
      <ReportsArea {...props} />
    </ActiveViewContext.Provider>,
  );
}

const hasName = (element: HTMLElement): boolean => {
  if ((element.getAttribute("aria-label") ?? "").trim() !== "") return true;
  if (element.getAttribute("aria-labelledby")) return true;
  const labels = (element as HTMLInputElement).labels;
  if (labels && Array.from(labels).some((label) => (label.textContent ?? "").trim() !== "")) return true;
  return (element.textContent ?? "").trim() !== "";
};

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  m.fetchReport.mockResolvedValue({ ok: true, data: securityReport() });
  m.listRuns.mockResolvedValue({ ok: true, data: { runs: [runView({ id: "run-1", status: "completed" })] } });
  m.fetchRetainedData.mockResolvedValue({ ok: true, data: retainedData() });
  m.exportSecurityPostman.mockResolvedValue({ ok: true, data: exportReply({ excluded: [{ scenarioId: "ss-5", reason: "stale" }] }) });
});

describe("ReportsArea accessibility (T157, CLAUDE.md section 38)", () => {
  it("gives every button, field and disclosure an accessible name, including the export and the retained data", async () => {
    const { container } = renderReports();
    await screen.findByTestId("report-body");
    await screen.findAllByTestId("retained-row");
    fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
    await screen.findByTestId("security-export-success");

    const controls = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, summary"));
    expect(controls.length).toBeGreaterThan(8);
    const unnamed = controls.filter((control) => !hasName(control)).map((control) => control.outerHTML.slice(0, 80));
    expect(unnamed).toEqual([]);
  });

  it("uses native controls only, with no positive tab index and no inline style", async () => {
    const { container } = renderReports();
    await screen.findByTestId("report-body");
    expect(container.querySelectorAll('[role="button"]:not(button)')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll("[tabindex]")).filter((el) => Number(el.getAttribute("tabindex")) > 0)).toHaveLength(0);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("can be operated from the keyboard: every enabled control and every scroll region takes focus", async () => {
    const { container } = renderReports();
    await screen.findByTestId("report-body");
    await screen.findAllByTestId("retained-row");
    const focusable = [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("checkbox"),
      ...screen.getAllByRole("textbox"),
      ...Array.from(container.querySelectorAll<HTMLElement>('[role="region"][tabindex="0"]')),
    ].filter((el) => !(el as HTMLButtonElement).disabled);
    expect(focusable.length).toBeGreaterThan(8);
    for (const element of focusable) {
      element.focus();
      expect(element).toHaveFocus();
    }
    // Wide tables scroll inside their own focusable, named region, so a keyboard user can reach the hidden columns.
    for (const name of ["Category coverage", "Findings in the report", "Runs in the report"]) {
      expect(screen.getByRole("region", { name })).toHaveAttribute("tabindex", "0");
    }
  });

  it("gives tables captions and scoped headers, and every section a heading in order", async () => {
    renderReports();
    await screen.findByTestId("report-body");
    await screen.findAllByTestId("retained-row");
    for (const table of screen.getAllByRole("table")) {
      expect(table.querySelector("caption")?.textContent?.trim()).toBeTruthy();
      for (const header of Array.from(table.querySelectorAll("thead th"))) expect(header).toHaveAttribute("scope", "col");
    }
    for (const name of ["Assessment report", "Export approved scenarios (Postman)", "Retained data"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    for (const name of ["Assessment summary", "Category coverage and outcomes", "Findings and remediation status", "Runs included"]) {
      expect(screen.getByRole("heading", { level: 3, name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("states every outcome, severity and status as text, never as an empty badge", async () => {
    renderReports();
    await screen.findByTestId("report-body");
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBeGreaterThan(3);
    expect(badges.filter((badge) => (badge.textContent ?? "").trim() === "")).toHaveLength(0);
    expect(screen.getByText("Blocked, errored and not run are not passes.")).toBeInTheDocument();
  });

  it("explains a disabled download or export in text tied to the control", async () => {
    m.fetchReport.mockResolvedValue(NOTHING);
    renderReports({ specificationLoaded: false });
    await screen.findByTestId("report-nothing");
    expect(screen.getByRole("button", { name: "Download HTML report" })).toHaveAccessibleDescription("There is nothing to report yet, so there is nothing to download.");
    expect(screen.getByRole("button", { name: "Export approved scenarios" })).toHaveAccessibleDescription(/No specification is loaded/);
  });

  it("announces the export outcome: success as text with a named list of files, an empty set and a failure each in their own state", async () => {
    renderReports();
    await screen.findByTestId("report-body");
    fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
    await screen.findByTestId("security-export-success");
    expect(within(screen.getByTestId("security-export-downloads")).getAllByRole("button")).toHaveLength(3);
    expect(within(screen.getByTestId("security-export-excluded")).getAllByRole("listitem")[0]).toHaveTextContent("ss-5: the specification changed");

    m.exportSecurityPostman.mockResolvedValueOnce({ ok: false, error: "no_approved_scenarios", message: "There are no approved scenarios to export.", status: 409, details: {} });
    fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
    expect(await screen.findByTestId("security-export-empty")).toHaveTextContent("There are no approved scenarios to export.");

    m.exportSecurityPostman.mockResolvedValueOnce({ ok: false, error: "export_failed", message: "The collection did not pass validation.", status: 422, details: {} });
    fireEvent.click(screen.getByRole("button", { name: "Export approved scenarios" }));
    const failure = await screen.findByTestId("security-export-error");
    expect(failure).toHaveTextContent("The export failed: The collection did not pass validation.");
    expect(screen.queryByTestId("security-export-empty")).not.toBeInTheDocument();
  });

  it("keeps loading, error and nothing-to-report states distinct and announced", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.fetchReport>>) => void;
    m.fetchReport.mockReset();
    m.fetchReport.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderReports();
    expect(screen.getByRole("status", { name: "Building the report" })).toBeInTheDocument();
    resolve({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    expect(await screen.findByRole("alert")).toHaveTextContent("The report could not be built");
    expect(screen.queryByTestId("report-nothing")).not.toBeInTheDocument();
  });
});
