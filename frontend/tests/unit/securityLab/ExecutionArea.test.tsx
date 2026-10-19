import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileView, ScenarioListItem } from "@apipilot/shared-domain";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { ExecutionArea } from "../../../src/components/securityLab/ExecutionArea";
import * as client from "../../../src/services/securityLabClient";
import { NO_FLAGS, findingList, categoriesReply, profileView, runDetail, runPreview, runView, scenarioItem, scenarioResult, targetEnvironment } from "./securityFixtures";

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
  cancelRun: vi.fn(),
  checkProfile: vi.fn(),
  deleteProfile: vi.fn(),
  createProfile: vi.fn(),
  updateProfile: vi.fn(),
  createEnvironment: vi.fn(),
  setCredential: vi.fn(),
  fetchCredentialStatus: vi.fn(),
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
  cancelRun: vi.mocked(client.cancelRun),
  deleteProfile: vi.mocked(client.deleteProfile),
};

const GOOD = profileView({ profile: { id: "p-good", name: "Good profile", maxRequests: 100, maxConcurrency: 4, timeoutMs: 10000, permittedCategories: ["authentication"] } });
const INVALID = profileView({
  profile: { id: "p-bad", name: "Bad profile" },
  valid: false,
  problems: [{ field: "maxRequests", code: "limit_above_ceiling", message: "Above the ceiling." }],
});

const RUNNABLE = scenarioItem({ id: "ss-1", title: "Reject a request with no credentials", reviewState: "approved", flags: { ...NO_FLAGS, executable: true } });
const STALE = scenarioItem({ id: "ss-2", title: "Stale scenario", reviewState: "approved", flags: { ...NO_FLAGS, stale: true } });
const OTHER_CATEGORY = scenarioItem({ id: "ss-3", title: "Validate input", reviewState: "approved", categoryId: "input-validation", flags: { ...NO_FLAGS, blocked: true }, prerequisites: { total: 2, met: 0 } });

function serve(opts: { profiles?: ProfileView[]; items?: ScenarioListItem[]; runs?: ReturnType<typeof runView>[] } = {}) {
  m.listProfiles.mockResolvedValue({ ok: true, data: { profiles: opts.profiles ?? [GOOD, INVALID] } });
  m.listEnvironments.mockResolvedValue({ ok: true, data: { environments: [targetEnvironment()] } });
  m.fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  m.listFindings.mockResolvedValue({ ok: true, data: findingList([]) });
  m.listRuns.mockResolvedValue({ ok: true, data: { runs: opts.runs ?? [] } });
  m.listAllScenarios.mockResolvedValue({ ok: true, data: opts.items ?? [RUNNABLE, STALE, OTHER_CATEGORY] });
  m.fetchRun.mockResolvedValue({ ok: true, data: runDetail({ run: { status: "in-progress" } }) });
}

function renderArea() {
  return render(
    <ActiveViewContext.Provider value="security">
      <ExecutionArea />
    </ActiveViewContext.Provider>,
  );
}

async function chooseGoodProfile() {
  fireEvent.click(await screen.findByRole("button", { name: "Use Good profile for a run" }));
  await waitFor(() => expect(m.listAllScenarios).toHaveBeenLastCalledWith({ reviewState: "approved", profileId: "p-good" }, expect.anything()));
  await screen.findByRole("checkbox", { name: "Choose Reject a request with no credentials" });
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  serve();
});

describe("ExecutionArea (T107, FR-029, FR-034 to FR-047)", () => {
  it("warns up front that a run sends real requests and only after confirmation", async () => {
    renderArea();
    const note = await screen.findByTestId("execution-note");
    expect(note).toHaveTextContent("Running sends real requests");
    expect(note).toHaveTextContent("nothing is sent by previewing");
  });

  it("shows loading, then the profiles", async () => {
    renderArea();
    expect(screen.getByRole("status", { name: "Loading profiles" })).toBeInTheDocument();
    expect(await screen.findAllByTestId("profile-row")).toHaveLength(2);
  });

  it("shows unloadable profiles as an error with a retry, never as none", async () => {
    m.listProfiles.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderArea();
    const error = await screen.findByTestId("profiles-error");
    expect(error).toHaveTextContent("The Security Lab service is unreachable.");
    expect(error).toHaveTextContent("This is not an empty list.");
    expect(screen.queryByTestId("profile-list-empty")).not.toBeInTheDocument();
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("profile-row")).toHaveLength(2);
  });

  it("says there are no profiles yet, and opens a new-profile form", async () => {
    serve({ profiles: [] });
    renderArea();
    expect(await screen.findByTestId("profile-list-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New profile" }));
    expect(screen.getByRole("form", { name: "New profile" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("form", { name: "New profile" })).not.toBeInTheDocument();
  });

  it("opens the editor on a profile to edit it", async () => {
    renderArea();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Good profile" }));
    expect(screen.getByRole("form", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Profile name")).toHaveValue("Good profile");
  });

  it("does not allow an invalid profile to be chosen", async () => {
    renderArea();
    expect(await screen.findByRole("button", { name: "Use Bad profile for a run" })).toBeDisabled();
  });

  it("lists every approved scenario with no profile chosen, none selectable, with the reason in words, and Preview disabled with its reason", async () => {
    renderArea();
    const rows = await screen.findAllByTestId("approved-row");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveAttribute("data-selectable", "false");
      expect(within(row).getByRole("checkbox")).toBeDisabled();
      expect(row).toHaveTextContent("Choose a profile first");
    }
    expect(screen.getByRole("button", { name: "Preview run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview run" })).toHaveAccessibleDescription("Choose a valid profile first.");
  });

  it("judges the approved scenarios against the chosen profile and shows why each unselectable one cannot be chosen", async () => {
    renderArea();
    await chooseGoodProfile();
    const [runnable, stale, other] = screen.getAllByTestId("approved-row");
    expect(runnable).toHaveAttribute("data-selectable", "true");
    expect(within(runnable).getByRole("checkbox")).toBeEnabled();
    expect(within(runnable).getByText("Can run")).toBeInTheDocument();

    expect(within(stale).getByRole("checkbox")).toBeDisabled();
    expect(within(stale).getByText("Cannot be chosen")).toBeInTheDocument();
    expect(stale).toHaveTextContent("Its operation changed since it was generated. Regenerate it and approve the new version.");
    expect(within(stale).getByRole("checkbox")).toHaveAccessibleDescription(/Cannot be chosen.*Its operation changed/);

    expect(other).toHaveTextContent('The profile does not permit the "input-validation" category.');
    expect(other).toHaveTextContent("2 of 2 prerequisites are not met by this profile");
  });

  it("selects scenarios one by one, all that can run, and clears the choice", async () => {
    renderArea();
    await chooseGoodProfile();
    expect(screen.getByTestId("selection-count")).toHaveTextContent("0 selected of 1 that can run (3 approved).");
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected of 1 that can run");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("0 selected");
    fireEvent.click(screen.getByRole("button", { name: "Select all that can run" }));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
  });

  it("starts the run limits at the profile's own and refuses a raise, naming the profile's limit", async () => {
    renderArea();
    await chooseGoodProfile();
    expect(screen.getByLabelText("Most requests (at most 100)")).toHaveValue(100);
    expect(screen.getByLabelText("Most requests at once (at most 4)")).toHaveValue(4);
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    fireEvent.change(screen.getByLabelText("Most requests at once (at most 4)"), { target: { value: "5" } });
    expect(screen.getByTestId("limit-problems")).toHaveTextContent("Most requests at once is 5, above the 4 this profile allows. A run can lower a limit but never raise it.");
    expect(screen.getByRole("button", { name: "Preview run" })).toBeDisabled();
    expect(screen.getByTestId("preview-blocked")).toHaveTextContent("Fix the run limits first.");
    fireEvent.change(screen.getByLabelText("Most requests at once (at most 4)"), { target: { value: "2" } });
    expect(screen.queryByTestId("limit-problems")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview run" })).toBeEnabled();
  });

  it("previews with the explicit items, only the lowered limits, and opens the confirmation with the preview", async () => {
    m.previewRun.mockResolvedValue({ ok: true, data: runPreview() });
    renderArea();
    await chooseGoodProfile();
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    fireEvent.change(screen.getByLabelText("Most requests (at most 100)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview run" }));
    const dialog = await screen.findByTestId("run-plan-dialog");
    expect(m.previewRun).toHaveBeenCalledWith({ profileId: "p-good", items: [{ id: "ss-1", version: 1 }], limits: { maxRequests: 20 } });
    expect(dialog).toHaveTextContent("Real requests will be sent to this target.");
    expect(m.startRun).not.toHaveBeenCalled();
  });

  it("sends no limits when none was lowered", async () => {
    m.previewRun.mockResolvedValue({ ok: true, data: runPreview() });
    renderArea();
    await chooseGoodProfile();
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview run" }));
    await screen.findByTestId("run-plan-dialog");
    expect(m.previewRun.mock.calls[0][0]).toEqual({ profileId: "p-good", items: [{ id: "ss-1", version: 1 }] });
  });

  it("shows a refused preview with its problems and opens no confirmation", async () => {
    m.previewRun.mockResolvedValue({
      ok: false,
      error: "run_plan_invalid",
      message: "The run cannot start. Fix each listed problem and preview again.",
      status: 422,
      details: { problems: [{ code: "profile_invalid", message: "environmentId: production is refused." }] },
    });
    renderArea();
    await chooseGoodProfile();
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview run" }));
    const error = await screen.findByTestId("preview-error");
    expect(error).toHaveTextContent("The run cannot start.");
    expect(within(error).getByRole("list", { name: "Plan problems" })).toHaveTextContent("profile_invalid: environmentId: production is refused.");
    expect(screen.queryByTestId("run-plan-dialog")).not.toBeInTheDocument();
  });

  async function startThroughDialog() {
    m.previewRun.mockResolvedValue({ ok: true, data: runPreview() });
    m.startRun.mockResolvedValue({ ok: true, data: { run: runView({ id: "run-1" }) } });
    renderArea();
    await chooseGoodProfile();
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview run" }));
    await screen.findByTestId("run-plan-dialog");
    fireEvent.click(screen.getByLabelText(/I am authorized to test this target/));
    fireEvent.change(screen.getByLabelText("Type the target name"), { target: { value: "Staging" } });
    fireEvent.change(screen.getByLabelText("Type the base URL"), { target: { value: "https://api.example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
  }

  it("starts a confirmed run, follows it, and blocks a second preview while it is in progress", async () => {
    await startThroughDialog();
    expect(await screen.findByTestId("run-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("run-plan-dialog")).not.toBeInTheDocument();
    expect(m.startRun.mock.calls[0][0]).toMatchObject({ profileId: "p-good", planDigest: "d".repeat(64) });
    expect(screen.getByRole("button", { name: "Preview run" })).toBeDisabled();
    expect(screen.getByTestId("preview-blocked")).toHaveTextContent("A run is in progress. Wait for it to finish or cancel it first.");
  });

  it("frees the preview again when the run finishes, and shows its results", async () => {
    m.fetchRun.mockResolvedValue({ ok: true, data: runDetail({ run: { status: "completed" }, results: [scenarioResult({ outcome: "passed" })] }) });
    await startThroughDialog();
    const row = await screen.findByTestId("run-result-row");
    expect(within(row).getByText("Reject a request with no credentials")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Preview run" })).toBeEnabled());
    // The earlier-runs list is read again when a run finishes.
    expect(m.listRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("previews again from the confirmation when the plan changed", async () => {
    m.previewRun.mockResolvedValue({ ok: true, data: runPreview() });
    m.startRun.mockResolvedValue({ ok: false, error: "plan_changed", message: "The plan changed since it was previewed.", status: 409, details: {} });
    renderArea();
    await chooseGoodProfile();
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview run" }));
    await screen.findByTestId("run-plan-dialog");
    fireEvent.click(screen.getByLabelText(/I am authorized to test this target/));
    fireEvent.change(screen.getByLabelText("Type the target name"), { target: { value: "Staging" } });
    fireEvent.change(screen.getByLabelText("Type the base URL"), { target: { value: "https://api.example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Preview again" }));
    await waitFor(() => expect(m.previewRun).toHaveBeenCalledTimes(2));
    // A fresh dialog replaces the old one, with nothing carried over from it.
    expect(await screen.findByTestId("run-plan-dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/I am authorized to test this target/)).not.toBeChecked();
  });

  it("picks up a run still in progress after a reload", async () => {
    serve({ runs: [runView({ id: "run-live", status: "in-progress" })] });
    renderArea();
    expect(await screen.findByTestId("run-progress")).toBeInTheDocument();
    expect(m.fetchRun.mock.calls[0][0]).toBe("run-live");
    await waitFor(() => expect(screen.getByTestId("preview-blocked")).toHaveTextContent("A run is in progress."));
  });

  it("lists earlier runs and opens one to read its results", async () => {
    serve({ runs: [runView({ id: "run-old", status: "completed", startedAt: "2026-10-17T08:30:00.000Z" })] });
    m.fetchRun.mockResolvedValue({ ok: true, data: runDetail({ run: { id: "run-old", status: "completed" }, results: [scenarioResult({ outcome: "failed" })] }) });
    renderArea();
    const row = await screen.findByTestId("run-history-row");
    expect(row).toHaveTextContent("2026-10-17 08:30 UTC");
    expect(within(row).getByText("Completed")).toBeInTheDocument();
    expect(screen.queryByTestId("run-progress")).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Open the run started 2026-10-17 08:30 UTC" }));
    expect(await screen.findByTestId("run-progress")).toBeInTheDocument();
    expect(m.fetchRun.mock.calls[0][0]).toBe("run-old");
    expect(await screen.findByText("Failed", { selector: "[data-testid=status-badge]" })).toBeInTheDocument();
    // Reading a finished run does not block a new preview.
    expect(screen.getByTestId("preview-blocked")).toHaveTextContent("Choose a valid profile first.");
  });

  it("shows unloadable approved scenarios as an error with a retry", async () => {
    m.listAllScenarios.mockResolvedValueOnce({ ok: false, error: "network_error", message: "The Security Lab service is unreachable.", status: 0, details: {} });
    renderArea();
    const error = await screen.findByTestId("approved-error");
    expect(error).toHaveTextContent("This is not an empty list.");
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findAllByTestId("approved-row")).toHaveLength(3);
  });

  it("says there are no approved scenarios, as an empty state", async () => {
    serve({ items: [] });
    renderArea();
    expect(await screen.findByTestId("approved-empty")).toHaveTextContent("There are no approved scenarios yet.");
  });

  it("drops the choice of scenarios when another profile is chosen", async () => {
    serve({ profiles: [GOOD, profileView({ profile: { id: "p-two", name: "Second profile" } })] });
    renderArea();
    await chooseGoodProfile();
    fireEvent.click(screen.getByRole("checkbox", { name: "Choose Reject a request with no credentials" }));
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 selected");
    fireEvent.click(screen.getByRole("button", { name: "Use Second profile for a run" }));
    await waitFor(() => expect(m.listAllScenarios).toHaveBeenLastCalledWith({ reviewState: "approved", profileId: "p-two" }, expect.anything()));
    await waitFor(() => expect(screen.getByTestId("selection-count")).toHaveTextContent("0 selected"));
  });

  it("stops using a profile that is deleted", async () => {
    m.deleteProfile.mockResolvedValue({ ok: true, data: {} });
    renderArea();
    await chooseGoodProfile();
    fireEvent.click(screen.getByRole("button", { name: "Delete Good profile" }));
    serve({ profiles: [INVALID] });
    fireEvent.click(within(await screen.findByTestId("confirm-dialog")).getByRole("button", { name: "Delete profile (1)" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Use Good profile for a run" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("preview-blocked")).toHaveTextContent("Choose a valid profile first."));
  });
});
