import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ScenariosArea } from "../../../src/components/securityLab/ScenariosArea";
import * as client from "../../../src/services/securityLabClient";
import { CATEGORIES, NO_FLAGS, categoriesReply, scenarioDetail, scenarioItem, scenarioList, suggestReply } from "./securityFixtures";

vi.mock("../../../src/services/aiStatusClient", () => ({ fetchAiStatus: vi.fn().mockResolvedValue({ ok: true, status: { state: "ready", provider: "mock", reason: null } }) }));
vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchCategories: vi.fn(),
  fetchScope: vi.fn(),
  generateScenarios: vi.fn(),
  listScenarios: vi.fn(),
  listScenarioIds: vi.fn(),
  listAllScenarios: vi.fn(),
  fetchScenario: vi.fn(),
  editScenario: vi.fn(),
  reviewScenarios: vi.fn(),
  suggestScenarios: vi.fn(),
}));

const m = {
  fetchCategories: vi.mocked(client.fetchCategories),
  fetchScope: vi.mocked(client.fetchScope),
  generateScenarios: vi.mocked(client.generateScenarios),
  listScenarios: vi.mocked(client.listScenarios),
  listScenarioIds: vi.mocked(client.listScenarioIds),
  listAllScenarios: vi.mocked(client.listAllScenarios),
  fetchScenario: vi.mocked(client.fetchScenario),
  editScenario: vi.mocked(client.editScenario),
  reviewScenarios: vi.mocked(client.reviewScenarios),
  suggestScenarios: vi.mocked(client.suggestScenarios),
};

const FIRST = scenarioItem({ id: "ss-1", title: "Reject a request with no credentials" });
const SECOND = scenarioItem({ id: "ss-2", title: "Reject an expired token", categoryId: "input-validation", severity: "medium" });

function serve(items = [FIRST, SECOND], opts: { specLoaded?: boolean } = {}) {
  const specLoaded = opts.specLoaded ?? true;
  m.fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  m.fetchScope.mockResolvedValue(
    specLoaded ? { ok: true, data: { mode: "all", selectedCount: 9, totalCount: 9 } } : { ok: false, error: "no_specification", message: "No specification is loaded.", status: 409, details: {} },
  );
  m.listScenarios.mockImplementation(async () => ({ ok: true, data: scenarioList(items) }));
  m.listScenarioIds.mockImplementation(async () => ({ ok: true, data: { items: items.map((i) => ({ id: i.id, version: i.currentVersion })), total: items.length, capped: false } }));
  m.listAllScenarios.mockImplementation(async () => ({ ok: true, data: items }));
  m.fetchScenario.mockImplementation(async (id) => {
    const found = items.find((i) => i.id === id) ?? FIRST;
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

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
});

describe("ScenariosArea (T079, FR-004, FR-018 to FR-033)", () => {
  it("shows a loading state, then the scenarios, with the reading note", async () => {
    serve();
    renderArea();
    expect(screen.getByRole("status", { name: "Loading scenarios" })).toBeInTheDocument();
    expect(screen.queryByTestId("scenario-list-empty")).not.toBeInTheDocument();
    const rows = await screen.findAllByTestId("scenario-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId("scenario-reading-note")).toHaveTextContent("A scenario is a proposed test, not a result.");
    expect(within(rows[1]).getByText("Input validation")).toBeInTheDocument();
  });

  it("shows an unreadable list as an error with a retry, never as an empty list", async () => {
    serve();
    m.listScenarios.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderArea();
    const error = await screen.findByTestId("scenario-list-error");
    expect(error).toHaveTextContent("The Security Lab service is unreachable.");
    expect(error).toHaveTextContent("This is not an empty list.");
    expect(screen.queryByTestId("scenario-list-empty")).not.toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("scenario-row")).toHaveLength(2);
  });

  it("says there are no scenarios yet when none exist, as an empty state of its own", async () => {
    serve([]);
    renderArea();
    expect(await screen.findByTestId("scenario-list-empty")).toHaveTextContent("There are no scenarios yet.");
  });

  it("reads retained scenarios with no specification loaded, flagged as such, while generation is unavailable (FR-004)", async () => {
    const retained = scenarioItem({ id: "ss-1", flags: { ...NO_FLAGS, specificationNotLoaded: true } });
    serve([retained], { specLoaded: false });
    renderArea();
    const row = await screen.findByTestId("scenario-row");
    expect(within(row).getByText("Specification not loaded")).toBeInTheDocument();
    expect(await screen.findByTestId("scope-no-specification")).toHaveTextContent("Generation is unavailable");
    expect(screen.getByRole("button", { name: "Generate scenarios" })).toBeDisabled();
    expect(screen.queryByTestId("scenario-list-error")).not.toBeInTheDocument();
  });

  it("offers optional AI suggestions and reads the list again once drafts have been stored (T153)", async () => {
    serve();
    m.suggestScenarios.mockResolvedValue({ ok: true, data: suggestReply() });
    renderArea();
    await screen.findAllByTestId("scenario-row");
    const before = m.listScenarios.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Suggest scenarios" }));
    expect(await screen.findByTestId("suggest-outcome")).toHaveTextContent("1 suggestion was stored as a draft");
    await waitFor(() => expect(m.listScenarios.mock.calls.length).toBeGreaterThan(before));
  });

  it("applies a filter, starts again from page one and reads the list with it", async () => {
    serve();
    renderArea();
    await screen.findAllByTestId("scenario-row");
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "medium" } });
    await waitFor(() => expect(m.listScenarios).toHaveBeenLastCalledWith({ severity: "medium" }, { page: 1, pageSize: 25 }, expect.anything()));
    // The batch bar resolves the same filter.
    await waitFor(() => expect(m.listScenarioIds).toHaveBeenLastCalledWith({ severity: "medium" }, expect.anything()));
  });

  it("opens a scenario from the list, loads its detail and moves focus to it", async () => {
    serve();
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Reject an expired token" }));
    expect(m.fetchScenario).toHaveBeenCalledWith("ss-2", expect.anything());
    const heading = await screen.findByRole("heading", { level: 3, name: "Reject an expired token" });
    expect(heading).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("scenario-detail-panel")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Reject an expired token", current: true })).toBeInTheDocument();
  });

  it("says what to do before a scenario is chosen", async () => {
    serve();
    renderArea();
    await screen.findAllByTestId("scenario-row");
    expect(screen.getByText(/Choose a scenario in the list to read its request/)).toBeInTheDocument();
  });

  it("shows a scenario that could not be loaded as an error with a retry", async () => {
    serve();
    m.fetchScenario.mockResolvedValueOnce({ ok: false, error: "scenario_not_found", message: "No security scenario with id 'ss-1' was found.", status: 404, details: {} });
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: FIRST.title }));
    const error = await screen.findByTestId("scenario-detail-error");
    expect(error).toHaveTextContent("No security scenario with id 'ss-1' was found.");
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { level: 3, name: FIRST.title })).toBeInTheDocument();
  });

  it("applies a review action to the open scenario, shows the outcome and reads the list and the scenario again", async () => {
    serve([scenarioItem({ id: "ss-1", title: "T", reviewState: "draft" })]);
    m.reviewScenarios.mockResolvedValue({ ok: true, data: { applied: [{ id: "ss-1", version: 1, applied: true, reviewState: "in_review" }], refused: [] } });
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "T" }));
    await screen.findByRole("heading", { level: 3, name: "T" });
    const listCalls = m.listScenarios.mock.calls.length;
    const detailCalls = m.fetchScenario.mock.calls.length;
    fireEvent.click(within(screen.getByTestId("scenario-review-actions")).getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByTestId("review-outcome-summary")).toHaveTextContent("1 of 1 scenario was submitted for review.");
    await waitFor(() => expect(m.listScenarios.mock.calls.length).toBeGreaterThan(listCalls));
    await waitFor(() => expect(m.fetchScenario.mock.calls.length).toBeGreaterThan(detailCalls));
  });

  it("edits the open scenario, says what the saved edit did and reads it again", async () => {
    const detail = scenarioDetail({ scenario: { id: "ss-1", reviewState: "approved" } });
    serve([detail.scenario]);
    m.editScenario.mockResolvedValue({ ok: true, data: { scenarioId: "ss-1", version: 2, material: true, reviewState: "in_review", scenario: detail } });
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: detail.scenario.title }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit scenario" }));
    fireEvent.change(screen.getByLabelText("Evaluation conditions (JSON list)"), { target: { value: '[{"kind":"status.equals","code":403}]' } });
    expect(screen.getByTestId("edit-effect")).toHaveTextContent("The approval of version 1 will be withdrawn");
    const detailCalls = m.fetchScenario.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Save as version 2" }));
    expect(await screen.findByTestId("edit-notice")).toHaveTextContent("Saved as version 2. The edit was material, so earlier approval did not carry over; the scenario is in review.");
    expect(screen.queryByTestId("scenario-editor")).not.toBeInTheDocument();
    await waitFor(() => expect(m.fetchScenario.mock.calls.length).toBeGreaterThan(detailCalls));
  });

  it("does not offer to edit a rejected scenario, and says why", async () => {
    serve([scenarioItem({ id: "ss-1", title: "R", reviewState: "rejected" })]);
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "R" }));
    const edit = await screen.findByRole("button", { name: "Edit scenario" });
    expect(edit).toBeDisabled();
    expect(screen.getByText("A rejected scenario cannot be edited. Reopen it first.")).toBeInTheDocument();
  });

  it("closes the editor without saving", async () => {
    serve();
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: FIRST.title }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit scenario" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("scenario-editor")).not.toBeInTheDocument();
    expect(m.editScenario).not.toHaveBeenCalled();
  });

  it("reads the list again after generating", async () => {
    serve();
    m.generateScenarios.mockResolvedValue({ ok: true, data: { scope: { mode: "all", included: 9, excluded: 0 }, created: 2, kept: 0, newVersions: 0, rejected: [], omittedByCap: [], notes: [] } });
    renderArea();
    await screen.findAllByTestId("scenario-row");
    const calls = m.listScenarios.mock.calls.length;
    fireEvent.click(await screen.findByRole("button", { name: "Generate scenarios" }));
    await screen.findByTestId("generation-summary");
    await waitFor(() => expect(m.listScenarios.mock.calls.length).toBeGreaterThan(calls));
  });

  it("shows a batch outcome in the area and keeps it until dismissed", async () => {
    serve([scenarioItem({ id: "ss-1", title: "A", reviewState: "draft", currentVersion: 1 })]);
    m.reviewScenarios.mockResolvedValue({
      ok: true,
      data: { applied: [], refused: [{ id: "ss-1", version: 1, applied: false, reasonCode: "not_executable_content", message: "No specification is loaded, so this scenario cannot be checked against it." }] },
    });
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Review these 1 scenario as a batch" }));
    await screen.findByTestId("batch-panel");
    fireEvent.click(screen.getByRole("button", { name: "Submit for review: 1 scenario" }));
    const outcome = await screen.findByTestId("review-outcomes");
    expect(within(outcome).getByRole("status")).toHaveTextContent("The scenario was not submitted for review: it was refused.");
    expect(within(outcome).getByText("No specification is loaded, so this scenario cannot be checked against it.")).toBeInTheDocument();
    fireEvent.click(within(outcome).getByRole("button", { name: "Dismiss outcome" }));
    expect(screen.queryByTestId("review-outcomes")).not.toBeInTheDocument();
  });
});

describe("ScenariosArea category labels", () => {
  it("uses category names from the registry in the list and filter", async () => {
    serve();
    renderArea();
    await screen.findAllByTestId("scenario-row");
    expect(within(screen.getByLabelText("Category")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Any", ...CATEGORIES.filter((c) => c.generatable).map((c) => c.name)]);
  });
});
