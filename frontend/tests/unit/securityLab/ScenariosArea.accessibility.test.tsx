import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ScenariosArea } from "../../../src/components/securityLab/ScenariosArea";
import * as client from "../../../src/services/securityLabClient";
import { NO_FLAGS, categoriesReply, scenarioDetail, scenarioItem, scenarioList } from "./securityFixtures";

vi.mock("../../../src/services/aiStatusClient", () => ({ fetchAiStatus: vi.fn().mockResolvedValue({ ok: true, status: { state: "ready", provider: "mock", reason: null } }) }));
vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchCategories: vi.fn(),
  fetchScope: vi.fn(),
  listScenarios: vi.fn(),
  listScenarioIds: vi.fn(),
  listAllScenarios: vi.fn(),
  fetchScenario: vi.fn(),
  reviewScenarios: vi.fn(),
}));

const m = {
  fetchCategories: vi.mocked(client.fetchCategories),
  fetchScope: vi.mocked(client.fetchScope),
  listScenarios: vi.mocked(client.listScenarios),
  listScenarioIds: vi.mocked(client.listScenarioIds),
  listAllScenarios: vi.mocked(client.listAllScenarios),
  fetchScenario: vi.mocked(client.fetchScenario),
  reviewScenarios: vi.mocked(client.reviewScenarios),
};

const ITEMS = [
  scenarioItem({ id: "ss-1", title: "Plain scenario", reviewState: "in_review", currentVersion: 1 }),
  scenarioItem({ id: "ss-2", title: "Delete an order", reviewState: "in_review", destructive: true, operationKey: "DELETE /orders/{id}", currentVersion: 1 }),
  scenarioItem({ id: "ss-3", title: "Stale scenario", reviewState: "in_review", flags: { ...NO_FLAGS, stale: true }, currentVersion: 1 }),
];

function setup() {
  m.fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  m.fetchScope.mockResolvedValue({ ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } });
  m.listScenarios.mockResolvedValue({ ok: true, data: scenarioList(ITEMS) });
  m.listScenarioIds.mockResolvedValue({ ok: true, data: { items: ITEMS.map((i) => ({ id: i.id, version: i.currentVersion })), total: ITEMS.length, capped: false } });
  m.listAllScenarios.mockResolvedValue({ ok: true, data: ITEMS });
  m.fetchScenario.mockImplementation(async (id) => {
    const found = ITEMS.find((i) => i.id === id) ?? ITEMS[0];
    return { ok: true, data: scenarioDetail({ scenario: found, content: { title: found.title } }) };
  });
}

function renderArea() {
  return render(
    <ActiveViewContext.Provider value="security">
      <ScenariosArea />
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
  setup();
});

describe("ScenariosArea accessibility (T079, CLAUDE.md section 38)", () => {
  it("gives every button, field and select an accessible name", async () => {
    const { container } = renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Plain scenario" }));
    await screen.findByRole("heading", { level: 3, name: "Plain scenario" });
    fireEvent.click(await screen.findByRole("button", { name: /as a batch/ }));
    await screen.findByTestId("batch-panel");
    fireEvent.click(screen.getByRole("button", { name: "Edit scenario" }));
    await screen.findByTestId("scenario-editor");

    const controls = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, summary"));
    expect(controls.length).toBeGreaterThan(20);
    const unnamed = controls.filter((control) => !hasName(control)).map((control) => control.outerHTML.slice(0, 80));
    expect(unnamed).toEqual([]);
  });

  it("uses native controls only: nothing that acts like a button is a bare element, and no control takes a positive tab index", async () => {
    const { container } = renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Plain scenario" }));
    await screen.findByRole("heading", { level: 3, name: "Plain scenario" });
    expect(container.querySelectorAll('[role="button"]:not(button)')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll("[tabindex]")).filter((el) => Number(el.getAttribute("tabindex")) > 0)).toHaveLength(0);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("can be reached and operated from the keyboard: the list title, the actions and the scroll regions all take focus", async () => {
    const { container } = renderArea();
    const title = await screen.findByRole("button", { name: "Plain scenario" });
    title.focus();
    expect(title).toHaveFocus();
    fireEvent.click(title);
    await waitFor(() => expect(screen.getByTestId("scenario-detail-panel")).toHaveFocus());
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
    // Wide tables scroll inside their own focusable region, so a keyboard user can reach the hidden columns.
    expect(screen.getByRole("region", { name: "Security scenarios" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("region", { name: "Scenario versions" })).toHaveAttribute("tabindex", "0");
  });

  it("gives tables captions and scoped headers, and the page labelled sections with a heading order", async () => {
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Plain scenario" }));
    await screen.findByRole("heading", { level: 3, name: "Plain scenario" });
    for (const table of screen.getAllByRole("table")) {
      expect(table.querySelector("caption")?.textContent?.trim()).toBeTruthy();
      for (const header of Array.from(table.querySelectorAll("thead th"))) expect(header).toHaveAttribute("scope", "col");
    }
    for (const name of ["Generate scenarios", "Scenarios", "Review in bulk", "Scenario detail"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("marks the open scenario in the list for assistive technology, not only by background", async () => {
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Plain scenario" }));
    expect(await screen.findByRole("button", { name: "Plain scenario", current: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete an order" })).not.toHaveAttribute("aria-current");
  });

  it("states every state, severity, flag and destructive mark as text, and never as an empty badge", async () => {
    renderArea();
    await screen.findAllByTestId("scenario-row");
    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBeGreaterThan(10);
    expect(badges.filter((badge) => (badge.textContent ?? "").trim() === "")).toHaveLength(0);
    const destructive = screen.getByText("Delete an order").closest("tr") as HTMLElement;
    expect(within(destructive).getByText("Destructive")).toBeInTheDocument();
    expect(within(screen.getByText("Stale scenario").closest("tr") as HTMLElement).getByText("Stale")).toBeInTheDocument();
    // The meaning of each flag is also written out, so it does not depend on the badge's tooltip or colour.
    expect(screen.getByTestId("flag-legend")).toHaveTextContent("Stale: The operation changed since this scenario was generated.");
  });

  it("explains a disabled action in text tied to the control", async () => {
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Stale scenario" }));
    await screen.findByRole("heading", { level: 3, name: "Stale scenario" });
    const approve = within(screen.getByTestId("scenario-review-actions")).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAccessibleDescription(/Approve is unavailable: The operation changed since this scenario was generated/);
  });

  it("announces a batch outcome as a status message and gives each result as text, applied or refused", async () => {
    m.reviewScenarios.mockResolvedValue({
      ok: true,
      data: {
        applied: [{ id: "ss-1", version: 1, applied: true, reviewState: "approved" }],
        refused: [{ id: "ss-3", version: 1, applied: false, reasonCode: "stale_version", message: "The scenario is at version 2, not 1." }],
      },
    });
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: /as a batch/ }));
    await screen.findByTestId("batch-panel");
    fireEvent.click(screen.getByRole("radio", { name: /^Approve/ }));
    fireEvent.click(screen.getByLabelText(/Include incomplete scenarios/));
    fireEvent.click(screen.getByRole("button", { name: /^Approve: \d+ scenarios?$/ }));

    const outcome = await screen.findByTestId("review-outcomes");
    expect(within(outcome).getByRole("status")).toHaveTextContent("1 of 2 scenarios was approved; 1 was refused.");
    const refused = within(outcome).getAllByTestId("review-outcome-row").find((row) => row.getAttribute("data-result") === "refused") as HTMLElement;
    expect(within(refused).getByText("Refused: Version changed")).toBeInTheDocument();
    expect(within(refused).getByText("The scenario is at version 2, not 1.")).toBeInTheDocument();
    // Applied results are written as text too (the list is collapsed, but its rows are in the document).
    const appliedRow = within(outcome).getAllByTestId("review-outcome-row").find((row) => row.getAttribute("data-result") === "applied") as HTMLElement;
    expect(within(appliedRow).getByText("Applied")).toBeInTheDocument();
    expect(within(appliedRow).getByText("Now approved.")).toBeInTheDocument();
  });

  it("opens the destructive confirmation as a named alert dialog with focus on Cancel, and Escape cancels it", async () => {
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: /as a batch/ }));
    await screen.findByTestId("batch-panel");
    fireEvent.click(screen.getByRole("radio", { name: /^Approve/ }));
    fireEvent.click(screen.getByLabelText(/Include destructive scenarios/));
    fireEvent.click(screen.getByRole("button", { name: /^Approve: \d+ scenarios?$/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName(/This batch includes 1 destructive scenario/);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(within(dialog).getByTestId("destructive-confirmation-list")).toHaveTextContent("Delete an order");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(m.reviewScenarios).not.toHaveBeenCalled();
  });

  it("keeps loading, error and empty states distinct and announced", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.listScenarios>>) => void;
    m.listScenarios.mockReset();
    m.listScenarios.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderArea();
    expect(screen.getByRole("status", { name: "Loading scenarios" })).toBeInTheDocument();
    resolve({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    expect(await screen.findByRole("alert")).toHaveTextContent("The scenarios could not be loaded");
    expect(screen.queryByTestId("scenario-list-empty")).not.toBeInTheDocument();
  });
});
