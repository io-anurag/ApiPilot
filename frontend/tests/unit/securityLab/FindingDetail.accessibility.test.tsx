import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { FindingDetail } from "../../../src/components/securityLab/FindingDetail";
import { FindingsList } from "../../../src/components/securityLab/FindingsList";
import * as client from "../../../src/services/securityLabClient";
import { evidenceRecord, finding, findingOccurrence } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  patchFinding: vi.fn(),
  fetchFindingEvidence: vi.fn(),
}));

const fetchFindingEvidence = vi.mocked(client.fetchFindingEvidence);

const RICH = finding({
  status: "accepted-risk",
  unreviewedOccurrence: true,
  supersedes: "sf-earlier",
  severity: { suggested: "high", current: "medium" },
  occurrences: [findingOccurrence({ resultId: "r1" }), findingOccurrence({ resultId: "r2", evidenceAvailable: false, at: "2026-10-19T08:30:00.000Z" })],
  history: [{ at: "2026-10-18T11:00:00.000Z", field: "status", from: "open", to: "accepted-risk", note: "Tracked", actor: "user" }],
});

const hasName = (element: HTMLElement): boolean => {
  if ((element.getAttribute("aria-label") ?? "").trim() !== "") return true;
  if (element.getAttribute("aria-labelledby")) return true;
  const labels = (element as HTMLInputElement).labels;
  if (labels && Array.from(labels).some((label) => (label.textContent ?? "").trim() !== "")) return true;
  return (element.textContent ?? "").trim() !== "";
};

function renderRich() {
  return render(
    <ActiveViewContext.Provider value="security">
      <FindingDetail finding={RICH} categoryName="Authentication" headingId="h" onChanged={vi.fn()} onOpenScenario={vi.fn()} onOpenRun={vi.fn()} onOpenFinding={vi.fn()} />
    </ActiveViewContext.Provider>,
  );
}

beforeEach(() => {
  fetchFindingEvidence.mockReset();
  fetchFindingEvidence.mockResolvedValue({ ok: true, data: { available: true, records: [evidenceRecord()] } });
});

describe("FindingDetail accessibility (T124, CLAUDE.md section 38)", () => {
  it("gives every button, field, select and summary an accessible name, with the evidence open", async () => {
    const { container } = renderRich();
    fireEvent.click(screen.getByRole("button", { name: /View the evidence of the occurrence at 2026-10-18/ }));
    await screen.findByTestId("code-block");
    const controls = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, summary"));
    expect(controls.length).toBeGreaterThan(8);
    expect(controls.filter((control) => !hasName(control)).map((control) => control.outerHTML.slice(0, 90))).toEqual([]);
  });

  it("uses native controls only, with no positive tab index and no inline style", () => {
    const { container } = renderRich();
    expect(container.querySelectorAll('[role="button"]:not(button)')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll("[tabindex]")).filter((el) => Number(el.getAttribute("tabindex")) > 0)).toHaveLength(0);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("is operable from the keyboard: every control and every scroll region takes focus", () => {
    const { container } = renderRich();
    const focusable = [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("combobox"),
      ...screen.getAllByRole("textbox"),
      ...Array.from(container.querySelectorAll<HTMLElement>('[role="region"][tabindex="0"]')),
    ].filter((el) => !(el as HTMLButtonElement).disabled);
    for (const element of focusable) {
      element.focus();
      expect(element).toHaveFocus();
    }
    for (const name of ["Occurrences of this finding", "Finding history"]) expect(screen.getByRole("region", { name })).toHaveAttribute("tabindex", "0");
  });

  it("names the finding in a heading, the article by it, and gives tables captions and scoped headers", () => {
    renderRich();
    expect(screen.getByRole("article", { name: "GET /orders: Authentication" })).toBeInTheDocument();
    for (const table of screen.getAllByRole("table")) {
      expect(table.querySelector("caption")?.textContent?.trim()).toBeTruthy();
      for (const header of Array.from(table.querySelectorAll("thead th"))) expect(header).toHaveAttribute("scope", "col");
    }
    for (const name of ["Expected and observed", "Occurrences (2)", "Remediation", "Where it came from", "Change status or severity", "History"]) {
      expect(screen.getByRole("heading", { level: 4, name })).toBeInTheDocument();
    }
  });

  it("states severity, status, the unreviewed marker and confidence as text, never as colour alone", () => {
    renderRich();
    for (const badge of screen.getAllByTestId("status-badge")) expect((badge.textContent ?? "").trim()).not.toBe("");
    const header = screen.getByTestId("finding-detail");
    expect(within(header).getByText("Severity: Medium")).toBeInTheDocument();
    expect(within(header).getByText("Status: Accepted risk")).toBeInTheDocument();
    expect(within(header).getAllByText("Unreviewed occurrence").length).toBeGreaterThan(0);
    expect(within(header).getAllByText("High confidence").length).toBe(2);
  });

  it("announces the unreviewed occurrence as a status and ties the disabled save to what is needed", () => {
    renderRich();
    expect(screen.getByRole("status")).toHaveTextContent("A new occurrence has not been reviewed");
    expect(screen.getByRole("button", { name: "Save change" })).toHaveAccessibleDescription(/Choose a new status or a new severity/);
  });

  it("states the occurrence whose raw evidence is gone as text instead of a button", () => {
    renderRich();
    const [first, second] = screen.getAllByTestId("occurrence-row");
    expect(within(first).getByRole("button", { name: /View the evidence/ })).toBeInTheDocument();
    expect(second).toHaveTextContent("Raw evidence is no longer available");
    expect(within(second).queryByRole("button", { name: /View the evidence/ })).not.toBeInTheDocument();
  });

  it("keeps the findings list operable by keyboard with named controls", () => {
    const onSelect = vi.fn();
    render(
      <FindingsList
        items={[RICH]}
        total={1}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
        selectedId={null}
        onSelect={onSelect}
        categoryNames={{ authentication: "Authentication" }}
        filtered={false}
        onClearFilters={vi.fn()}
      />,
    );
    const open = screen.getByRole("button", { name: "GET /orders: Authentication" });
    open.focus();
    expect(open).toHaveFocus();
    expect(screen.getByRole("region", { name: "Security findings" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table")).toHaveAccessibleName(/Security findings/);
  });
});
