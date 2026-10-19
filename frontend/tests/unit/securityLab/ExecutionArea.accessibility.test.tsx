import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ExecutionArea } from "../../../src/components/securityLab/ExecutionArea";
import * as client from "../../../src/services/securityLabClient";
import { NO_FLAGS, findingList, categoriesReply, cleanupEntry, profileView, runDetail, runPreview, runView, scenarioItem, scenarioResult, targetEnvironment } from "./securityFixtures";

vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  listProfiles: vi.fn(),
  listEnvironments: vi.fn(),
  fetchCategories: vi.fn(),
  listRuns: vi.fn(),
  listAllScenarios: vi.fn(),
  listFindings: vi.fn(),
  previewRun: vi.fn(),
  startRun: vi.fn(),
  fetchRun: vi.fn(),
}));

const m = {
  listProfiles: vi.mocked(client.listProfiles),
  listEnvironments: vi.mocked(client.listEnvironments),
  fetchCategories: vi.mocked(client.fetchCategories),
  listRuns: vi.mocked(client.listRuns),
  listAllScenarios: vi.mocked(client.listAllScenarios),
  listFindings: vi.mocked(client.listFindings),
  previewRun: vi.mocked(client.previewRun),
  startRun: vi.mocked(client.startRun),
  fetchRun: vi.mocked(client.fetchRun),
};

const DESTRUCTIVE = { scenarioId: "ss-d", version: 1, title: "Delete an order", operationKey: "DELETE /orders/{id}", categoryId: "authentication", plannedRequests: 1, destructive: true };

function serve() {
  m.listProfiles.mockResolvedValue({ ok: true, data: { profiles: [profileView({ profile: { id: "p-1", name: "Good profile" } })] } });
  m.listEnvironments.mockResolvedValue({ ok: true, data: { environments: [targetEnvironment()] } });
  m.fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  m.listFindings.mockResolvedValue({ ok: true, data: findingList([]) });
  m.listRuns.mockResolvedValue({ ok: true, data: { runs: [runView({ id: "run-old", status: "completed" })] } });
  m.listAllScenarios.mockResolvedValue({
    ok: true,
    data: [
      scenarioItem({ id: "ss-1", title: "Runnable scenario", reviewState: "approved", flags: { ...NO_FLAGS, executable: true } }),
      scenarioItem({ id: "ss-2", title: "Stale scenario", reviewState: "approved", flags: { ...NO_FLAGS, stale: true } }),
    ],
  });
  m.previewRun.mockResolvedValue({ ok: true, data: runPreview({ scenarios: [DESTRUCTIVE] }) });
  m.fetchRun.mockResolvedValue({
    ok: true,
    data: runDetail({
      run: {
        status: "cancelled",
        plan: [
          { scenarioId: "ss-1", version: 1, plannedRequests: 1 },
          { scenarioId: "ss-2", version: 1, plannedRequests: 1 },
          { scenarioId: "ss-3", version: 1, plannedRequests: 1 },
        ],
        cleanup: [cleanupEntry({ state: "failed", leftBehind: "Order 42", manualRemoval: "Delete order 42." })],
      },
      results: [scenarioResult({ outcome: "blocked" }), scenarioResult({ id: "res-2", scenarioId: "ss-2", outcome: "errored" })],
    }),
  });
}

function renderArea() {
  return render(
    <ActiveViewContext.Provider value="security">
      <ExecutionArea />
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

async function openEverything() {
  const view = renderArea();
  fireEvent.click(await screen.findByRole("button", { name: "Edit Good profile" }));
  fireEvent.click(await screen.findByRole("button", { name: "Open the run started 2026-10-18 10:00 UTC" }));
  await screen.findByTestId("run-progress");
  return view;
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  serve();
});

describe("ExecutionArea accessibility (T107, CLAUDE.md section 38)", () => {
  it("gives every button, field, select and summary an accessible name, with the editor and a run open", async () => {
    const { container } = await openEverything();
    const controls = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, summary"));
    expect(controls.length).toBeGreaterThan(30);
    expect(controls.filter((control) => !hasName(control)).map((control) => control.outerHTML.slice(0, 90))).toEqual([]);
  });

  it("uses native controls only, no positive tab index and no inline styles", async () => {
    const { container } = await openEverything();
    expect(container.querySelectorAll('[role="button"]:not(button)')).toHaveLength(0);
    expect(Array.from(container.querySelectorAll("[tabindex]")).filter((el) => Number(el.getAttribute("tabindex")) > 0)).toHaveLength(0);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("can be operated from the keyboard: every control and every scroll region takes focus", async () => {
    const { container } = await openEverything();
    const focusable = [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("combobox"),
      ...screen.getAllByRole("textbox"),
      ...screen.getAllByRole("checkbox"),
      ...Array.from(container.querySelectorAll<HTMLElement>('[role="region"][tabindex="0"]')),
    ].filter((el) => !(el as HTMLButtonElement).disabled);
    expect(focusable.length).toBeGreaterThan(30);
    for (const element of focusable) {
      element.focus();
      expect(element).toHaveFocus();
    }
    for (const name of ["Security profiles", "Approved scenarios", "Earlier runs", "Scenario results"]) {
      expect(screen.getByRole("region", { name })).toHaveAttribute("tabindex", "0");
    }
  });

  it("gives tables captions and scoped column headers, and the sections headings in order", async () => {
    await openEverything();
    for (const table of screen.getAllByRole("table")) {
      expect(table.querySelector("caption")?.textContent?.trim()).toBeTruthy();
      for (const header of Array.from(table.querySelectorAll("thead th"))) expect(header).toHaveAttribute("scope", "col");
    }
    for (const name of ["Profiles", "Choose what to run", "Run"]) expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
  });

  it("never shows a credential in anything but a labelled, empty password field that is named write-only", async () => {
    await openEverything();
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.value).toBe("");
      expect(input).toHaveAccessibleName(/write-only/);
    }
  });

  it("shows every outcome as text, and blocked, errored and not run as not a pass", async () => {
    await openEverything();
    const rows = screen.getAllByTestId("run-result-row");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => within(row).getByTestId("status-badge").textContent)).toEqual(["Blocked", "Errored", "Not run"]);
    for (const row of rows) expect(row).toHaveTextContent(/This is not a pass\./);
    for (const badge of screen.getAllByTestId("status-badge")) expect((badge.textContent ?? "").trim()).not.toBe("");
  });

  it("announces cleanup that did not finish as an alert with what is left behind", async () => {
    await openEverything();
    expect(screen.getByRole("alert")).toHaveTextContent("Cleanup did not finish for 1 item.");
    expect(screen.getByTestId("cleanup-entry")).toHaveTextContent("Left behind: Order 42");
  });

  it("explains a disabled Preview in text tied to the button", async () => {
    renderArea();
    const preview = await screen.findByRole("button", { name: "Preview run" });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAccessibleDescription("Choose a valid profile first.");
  });

  it("opens the confirmation as a named alert dialog with focus on Cancel, ties a disabled Start to what is needed, and closes on Escape", async () => {
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Use Good profile for a run" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Choose Runnable scenario" }));
    const previewButton = screen.getByRole("button", { name: "Preview run" });
    fireEvent.click(previewButton);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Confirm this run");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    const start = within(dialog).getByRole("button", { name: "Start run" });
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(/Confirm that you are authorized to test this target\./);
    expect(start).toHaveAccessibleDescription(/Type the exact target name\./);
    expect(start).toHaveAccessibleDescription(/Confirm each destructive scenario/);
    for (const field of within(dialog).getAllByRole("textbox")) expect(field).toHaveAccessibleName();
    for (const box of within(dialog).getAllByRole("checkbox")) expect(box).toHaveAccessibleName();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(m.startRun).not.toHaveBeenCalled();
  });
});
