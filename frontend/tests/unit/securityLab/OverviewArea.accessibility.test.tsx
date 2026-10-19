import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { OverviewArea } from "../../../src/components/securityLab/OverviewArea";
import * as client from "../../../src/services/securityLabClient";
import { analysisReply, categoriesReply, observation, overview } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchAnalysis: vi.fn(),
  fetchCategories: vi.fn(),
  fetchOverview: vi.fn(),
  saveSettings: vi.fn(),
}));

const fetchAnalysis = vi.mocked(client.fetchAnalysis);
const fetchCategories = vi.mocked(client.fetchCategories);
const fetchOverview = vi.mocked(client.fetchOverview);

const OBSERVATIONS = [
  observation({ id: "r1", classification: "potential-risk", operationKey: "POST /admin/users", elementPointer: "/operations/POST /admin/users/security" }),
  observation({ id: "i1", classification: "informational" }),
  observation({ id: "c1", ruleId: "sensitive-operation", classification: "requires-context", operationKey: "GET /accounts/{id}", elementPointer: "/operations/GET /accounts/{id}/security" }),
  observation({ id: "n1", ruleId: "effective-security-none-declared", classification: "not-measurable", operationKey: undefined, elementPointer: "/securitySchemes" }),
];

function renderOverview() {
  return render(
    <ActiveViewContext.Provider value="security">
      <OverviewArea />
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
  fetchAnalysis.mockReset();
  fetchCategories.mockReset();
  fetchOverview.mockReset();
  fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply(OBSERVATIONS) });
  fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  fetchOverview.mockResolvedValue({ ok: true, data: overview() });
});

describe("OverviewArea accessibility (T157, CLAUDE.md section 38)", () => {
  it("gives every button, field, select and disclosure an accessible name", async () => {
    const { container } = renderOverview();
    await screen.findByTestId("security-overview");
    await screen.findByTestId("overview-summary");
    const controls = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, summary"));
    expect(controls.length).toBeGreaterThan(5);
    const unnamed = controls.filter((control) => !hasName(control)).map((control) => control.outerHTML.slice(0, 80));
    expect(unnamed).toEqual([]);
  });

  it("uses native controls only, with no positive tab index and no inline style", async () => {
    const { container } = renderOverview();
    await screen.findByTestId("security-overview");
    expect(container.querySelectorAll('[role="button"]:not(button)')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll("[tabindex]")).filter((el) => Number(el.getAttribute("tabindex")) > 0)).toHaveLength(0);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("can be operated from the keyboard: every enabled control takes focus, and the observation filter is a labelled select", async () => {
    const { container } = renderOverview();
    await screen.findByTestId("security-overview");
    const focusable = [...screen.getAllByRole("button"), ...screen.getAllByRole("combobox"), ...Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'))].filter((el) => !(el as HTMLButtonElement).disabled);
    expect(focusable.length).toBeGreaterThan(0);
    for (const element of focusable) {
      element.focus();
      expect(element).toHaveFocus();
    }
    const filter = screen.getByRole("combobox", { name: /Show/ });
    fireEvent.change(filter, { target: { value: "requires-context" } });
    expect(filter).toHaveValue("requires-context");
  });

  it("gives tables captions and scoped headers, and every section a heading in order", async () => {
    renderOverview();
    await screen.findByTestId("security-overview");
    for (const table of screen.getAllByRole("table")) {
      expect(table.querySelector("caption")?.textContent?.trim()).toBeTruthy();
      for (const header of Array.from(table.querySelectorAll("thead th"))) expect(header).toHaveAttribute("scope", "col");
    }
    for (const name of ["Scenarios (proposed tests)", "Latest run", "Findings (from requests sent)", "Potential risks (specification analysis)", "Other observations", "Categories and support levels", "Sensitive fields you configure"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("states each classification as text on its count and in its list, never as colour alone", async () => {
    renderOverview();
    await screen.findByTestId("security-overview");
    const tiles = screen.getAllByTestId("stat-tile");
    for (const label of ["Informational observation", "Potential risk", "Requires additional context", "Not measurable"]) {
      expect(tiles.some((tile) => within(tile).queryByText(label) !== null)).toBe(true);
    }
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.filter((badge) => (badge.textContent ?? "").trim() === "")).toHaveLength(0);
  });

  it("keeps loading, error and empty states distinct and announced", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.fetchAnalysis>>) => void;
    fetchAnalysis.mockReset();
    fetchAnalysis.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderOverview();
    expect(screen.getByRole("status", { name: "Analyzing the specification" })).toBeInTheDocument();
    resolve({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    const alert = await screen.findByTestId("security-analysis-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent("This is not an empty result.");
    expect(screen.queryByTestId("security-analysis-empty")).not.toBeInTheDocument();
    await waitFor(() => expect(within(alert).getByRole("button", { name: "Retry" })).toBeEnabled());
  });
});
