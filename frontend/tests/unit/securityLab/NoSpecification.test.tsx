import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveViewContext } from "../../../src/components/requestChain/activeView";
import { SecurityLabPage } from "../../../src/pages/SecurityLabPage";
import type { SecurityArea } from "../../../src/navigation/routes";
import * as client from "../../../src/services/securityLabClient";
import {
  NO_FLAGS,
  categoriesReply,
  finding,
  findingList,
  findingOccurrence,
  overview,
  profileView,
  retainedData,
  runDetail,
  runView,
  scenarioDetail,
  scenarioItem,
  scenarioList,
  scenarioResult,
  securityReport,
  targetEnvironment,
} from "./securityFixtures";

vi.mock("../../../src/services/aiStatusClient", () => ({ fetchAiStatus: vi.fn().mockResolvedValue({ ok: true, status: { state: "ready", provider: "mock", reason: null } }) }));
vi.mock("../../../src/services/securityLabClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/services/securityLabClient")>()),
  fetchAnalysis: vi.fn(),
  fetchCategories: vi.fn(),
  fetchOverview: vi.fn(),
  fetchScope: vi.fn(),
  generateScenarios: vi.fn(),
  listScenarios: vi.fn(),
  listScenarioIds: vi.fn(),
  listAllScenarios: vi.fn(),
  fetchScenario: vi.fn(),
  reviewScenarios: vi.fn(),
  listFindings: vi.fn(),
  fetchFinding: vi.fn(),
  fetchFindingEvidence: vi.fn(),
  listProfiles: vi.fn(),
  listEnvironments: vi.fn(),
  listRuns: vi.fn(),
  fetchRun: vi.fn(),
  previewRun: vi.fn(),
  fetchReport: vi.fn(),
  downloadReport: vi.fn(),
  fetchRetainedData: vi.fn(),
  suggestScenarios: vi.fn(),
  exportSecurityPostman: vi.fn(),
}));
vi.mock("../../../src/components/securityLab/saveBlob", () => ({ saveBlob: vi.fn() }));

const m = {
  fetchAnalysis: vi.mocked(client.fetchAnalysis),
  fetchCategories: vi.mocked(client.fetchCategories),
  fetchOverview: vi.mocked(client.fetchOverview),
  fetchScope: vi.mocked(client.fetchScope),
  generateScenarios: vi.mocked(client.generateScenarios),
  listScenarios: vi.mocked(client.listScenarios),
  listScenarioIds: vi.mocked(client.listScenarioIds),
  listAllScenarios: vi.mocked(client.listAllScenarios),
  fetchScenario: vi.mocked(client.fetchScenario),
  reviewScenarios: vi.mocked(client.reviewScenarios),
  listFindings: vi.mocked(client.listFindings),
  fetchFinding: vi.mocked(client.fetchFinding),
  fetchFindingEvidence: vi.mocked(client.fetchFindingEvidence),
  listProfiles: vi.mocked(client.listProfiles),
  listEnvironments: vi.mocked(client.listEnvironments),
  listRuns: vi.mocked(client.listRuns),
  fetchRun: vi.mocked(client.fetchRun),
  previewRun: vi.mocked(client.previewRun),
  fetchReport: vi.mocked(client.fetchReport),
  downloadReport: vi.mocked(client.downloadReport),
  fetchRetainedData: vi.mocked(client.fetchRetainedData),
};

const FLAGS = { ...NO_FLAGS, specificationNotLoaded: true };
const RETAINED = scenarioItem({ id: "ss-1", title: "Retained scenario", reviewState: "in_review", flags: FLAGS });
const APPROVED = scenarioItem({ id: "ss-2", title: "Retained approved scenario", reviewState: "approved", flags: FLAGS });
const RETAINED_FINDING = finding({ id: "sf-1", occurrences: [findingOccurrence({ evidenceAvailable: false })] });
const NO_SPEC_OVERVIEW = overview({
  specificationLoaded: false,
  specificationRevision: undefined,
  scope: undefined,
  observationCounts: { informational: 0, "potential-risk": 0, "requires-context": 0, "not-measurable": 0 },
  scenarioCounts: { ...overview().scenarioCounts, total: 2, byCategory: { authentication: 2 }, byReviewState: { draft: 0, in_review: 1, approved: 1, rejected: 0 }, stale: 0, blocked: 0, specificationNotLoaded: 2 },
  untestedHighPriority: [],
});

/** Everything retained is readable; everything that needs a specification says it is not loaded. */
function serveWithNoSpecification() {
  const noSpec = { ok: false as const, error: "no_specification", message: "No specification is loaded.", status: 409, details: {} };
  m.fetchAnalysis.mockResolvedValue(noSpec);
  m.fetchScope.mockResolvedValue(noSpec);
  m.fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
  m.fetchOverview.mockResolvedValue({ ok: true, data: NO_SPEC_OVERVIEW });
  m.listScenarios.mockResolvedValue({ ok: true, data: scenarioList([RETAINED, APPROVED]) });
  m.listScenarioIds.mockResolvedValue({ ok: true, data: { items: [{ id: "ss-1", version: 1 }, { id: "ss-2", version: 1 }], total: 2, capped: false } });
  m.listAllScenarios.mockImplementation(async (filters) => ({ ok: true, data: filters.reviewState === "approved" ? [APPROVED] : [RETAINED, APPROVED] }));
  m.fetchScenario.mockImplementation(async (id) => ({ ok: true, data: scenarioDetail({ scenario: id === "ss-2" ? APPROVED : RETAINED, content: { title: id === "ss-2" ? APPROVED.title : RETAINED.title } }) }));
  m.listFindings.mockResolvedValue({ ok: true, data: findingList([RETAINED_FINDING]) });
  m.fetchFinding.mockResolvedValue({ ok: true, data: RETAINED_FINDING });
  m.listProfiles.mockResolvedValue({ ok: true, data: { profiles: [profileView({ profile: { id: "p-1", name: "Staging run" } })] } });
  m.listEnvironments.mockResolvedValue({ ok: true, data: { environments: [targetEnvironment()] } });
  m.listRuns.mockResolvedValue({ ok: true, data: { runs: [runView({ id: "run-1", status: "completed" })] } });
  m.fetchRun.mockResolvedValue({ ok: true, data: runDetail({ run: { id: "run-1", status: "completed" }, results: [scenarioResult({ scenarioId: "ss-1", outcome: "failed" })] }) });
  m.fetchReport.mockResolvedValue({ ok: true, data: securityReport({ overview: NO_SPEC_OVERVIEW, specificationRevision: undefined }) });
  m.fetchRetainedData.mockResolvedValue({ ok: true, data: retainedData() });
}

function renderPage(area: SecurityArea) {
  return render(
    <ActiveViewContext.Provider value="security">
      <SecurityLabPage specificationLoaded={false} area={area} onAreaChange={vi.fn()} />
    </ActiveViewContext.Provider>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset();
  serveWithNoSpecification();
});

describe("Security Lab with no specification loaded (T136, FR-004, FR-051)", () => {
  it.each(["overview", "scenarios", "execution", "reports"] as const)("shows the not-loaded notice, with the way to proceed, on the %s area", async (area) => {
    renderPage(area);
    const notice = screen.getByTestId("security-spec-not-loaded");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("No specification is loaded");
    expect(notice).toHaveTextContent("Upload one in the Guided Workflow to continue.");
    expect(notice).toHaveTextContent("are still shown and are marked “specification not loaded”");
    expect(await screen.findByTestId(`security-area-${area}`)).toBeInTheDocument();
  });

  describe("Overview", () => {
    it("shows the retained counts, which open their lists, and says the analysis and the untested list need a specification", async () => {
      renderPage("overview");
      expect(await screen.findByTestId("overview-spec-status")).toHaveTextContent("No specification is loaded. The figures below come from work retained earlier");
      expect(screen.getByRole("button", { name: "All scenarios 2" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Specification not loaded 2" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "All findings 3" })).toBeInTheDocument();
      expect(await screen.findByTestId("security-analysis-empty")).toHaveTextContent("Security analysis needs a specification.");
      expect(screen.getByTestId("overview-untested-unavailable")).toHaveTextContent("not available while no specification is loaded");
      // The category registry does not depend on a specification.
      expect(await screen.findByRole("heading", { name: "Categories and support levels" })).toBeInTheDocument();
      expect(screen.queryByTestId("security-analysis-error")).not.toBeInTheDocument();
    });
  });

  describe("Scenarios", () => {
    it("reads the retained scenarios, each marked specification not loaded, and does not fail", async () => {
      renderPage("scenarios");
      const rows = await screen.findAllByTestId("scenario-row");
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(within(row).getByText("Specification not loaded")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-list-error")).not.toBeInTheDocument();
      expect(screen.queryByTestId("scenario-list-empty")).not.toBeInTheDocument();
    });

    it("disables generation with the reason and the way to proceed, and never calls the server", async () => {
      renderPage("scenarios");
      const unavailable = await screen.findByTestId("scope-no-specification");
      expect(unavailable).toHaveTextContent("Generation is unavailable: no specification is loaded");
      expect(unavailable).toHaveTextContent("Upload one in the Guided Workflow to generate.");
      const generate = screen.getByRole("button", { name: "Generate scenarios" });
      expect(generate).toBeDisabled();
      expect(generate).toHaveAccessibleDescription(/Upload one in the Guided Workflow/);
      fireEvent.click(generate);
      expect(m.generateScenarios).not.toHaveBeenCalled();
    });

    it("disables the AI suggestion with the reason and never calls the model or the server", async () => {
      renderPage("scenarios");
      await screen.findByTestId("scope-no-specification");
      const suggest = screen.getByRole("button", { name: "Suggest scenarios" });
      expect(suggest).toBeDisabled();
      expect(screen.getByTestId("suggest-blocked")).toHaveTextContent("No specification is loaded, so there is nothing to suggest scenarios for.");
      expect(suggest).toHaveAccessibleDescription(/Upload one in the Guided Workflow/);
      fireEvent.click(suggest);
      expect(client.suggestScenarios).not.toHaveBeenCalled();
    });

    it("reads a retained scenario in full, and disables submit and approve with the reason while leaving reject and withdraw", async () => {
      renderPage("scenarios");
      fireEvent.click(await screen.findByRole("button", { name: "Retained scenario" }));
      await screen.findByRole("heading", { level: 3, name: "Retained scenario" });
      const flags = screen.getByRole("list", { name: "Why this scenario is flagged" });
      expect(flags).toHaveTextContent("It stays readable");
      const actions = screen.getByTestId("scenario-review-actions");
      const approve = within(actions).getByRole("button", { name: "Approve" });
      expect(approve).toBeDisabled();
      expect(approve).toHaveAccessibleDescription(/Approve is unavailable: No specification is loaded, so this scenario cannot be checked against it\./);
      expect(within(actions).getByRole("button", { name: "Reject" })).toBeEnabled();
      expect(within(actions).getByRole("button", { name: "Withdraw" })).toBeEnabled();
    });

    it("says a material edit needs a specification, and allows one that is not material", async () => {
      renderPage("scenarios");
      fireEvent.click(await screen.findByRole("button", { name: "Retained scenario" }));
      fireEvent.click(await screen.findByRole("button", { name: "Edit scenario" }));
      fireEvent.change(screen.getByLabelText("Evaluation conditions (JSON list)"), { target: { value: '[{"kind":"status.equals","code":403}]' } });
      expect(screen.getByRole("button", { name: "Save as version 2" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save as version 2" })).toHaveAccessibleDescription(/A material edit needs a loaded specification/);
      fireEvent.change(screen.getByLabelText("Evaluation conditions (JSON list)"), { target: { value: '[{"kind":"status.in-set","codes":[401]}]' } });
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Retitled" } });
      expect(screen.getByRole("button", { name: "Save as version 2" })).toBeEnabled();
    });

    it("leaves a batch of retained scenarios unable to submit, with the scenarios left out and why", async () => {
      renderPage("scenarios");
      fireEvent.click(await screen.findByRole("button", { name: /Review these 2 scenarios as a batch/ }));
      await screen.findByTestId("batch-panel");
      fireEvent.click(screen.getByRole("radio", { name: /^Approve/ }));
      expect(screen.getByTestId("batch-exclusions")).toHaveTextContent("cannot be checked against a current specification");
      expect(screen.getByRole("button", { name: "Approve: 0 scenarios" })).toBeDisabled();
    });
  });

  describe("Execution and Findings", () => {
    it("disables a run with the reason, still lists profiles, and shows every approved scenario as unselectable with why", async () => {
      renderPage("execution");
      expect(await screen.findAllByTestId("profile-row")).toHaveLength(1);
      const rows = await screen.findAllByTestId("approved-row");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByRole("checkbox")).toBeDisabled();
      expect(rows[0]).toHaveTextContent("Choose a profile first");
      const preview = screen.getByRole("button", { name: "Preview run" });
      expect(preview).toBeDisabled();
      expect(preview).toHaveAccessibleDescription("No specification is loaded, so a run cannot be checked against it. Upload one in the Guided Workflow to preview a run.");
      expect(m.previewRun).not.toHaveBeenCalled();
    });

    it("still gives the reason with a profile chosen, and judges the scenarios as not checkable", async () => {
      renderPage("execution");
      fireEvent.click(await screen.findByRole("button", { name: "Use Staging run for a run" }));
      await waitFor(() => expect(screen.getByTestId("approved-row")).toHaveTextContent("No specification is loaded, so it cannot be checked against its operation."));
      expect(screen.getByRole("button", { name: "Preview run" })).toBeDisabled();
      expect(screen.getByTestId("preview-blocked")).toHaveTextContent("No specification is loaded");
    });

    it("keeps findings readable, with the observed summary and a note that the raw evidence has gone", async () => {
      renderPage("execution");
      fireEvent.click(await screen.findByRole("button", { name: "GET /orders: Authentication" }));
      const detail = await screen.findByTestId("finding-detail");
      expect(detail).toHaveTextContent("Status 200. The operation answered 200 to a request with no credentials.");
      expect(detail).toHaveTextContent("Raw evidence is no longer available");
      expect(screen.queryByTestId("finding-list-error")).not.toBeInTheDocument();
    });

    it("keeps earlier runs readable, with their results", async () => {
      renderPage("execution");
      fireEvent.click(await screen.findByRole("button", { name: /Open the run started/ }));
      const row = await screen.findByTestId("run-result-row");
      expect(row).toHaveAttribute("data-outcome", "failed");
      expect(m.fetchRun).toHaveBeenCalledWith("run-1", expect.anything());
    });
  });

  describe("Reports", () => {
    it("builds and shows the report from retained work, says so, and leaves both downloads available", async () => {
      renderPage("reports");
      const summary = await screen.findByTestId("report-summary");
      expect(summary).toHaveTextContent("Specification: not loaded: this report is built from retained work");
      expect(screen.getByRole("button", { name: "Download HTML report" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Download JSON report" })).toBeEnabled();
      expect(screen.queryByTestId("report-error")).not.toBeInTheDocument();
    });

    it("disables the export of approved scenarios with the reason, because it needs a specification, and sends nothing", async () => {
      renderPage("reports");
      await screen.findByTestId("report-summary");
      const exportButton = screen.getByRole("button", { name: "Export approved scenarios" });
      expect(exportButton).toBeDisabled();
      expect(screen.getByTestId("security-export-blocked")).toHaveTextContent("No specification is loaded");
      expect(exportButton).toHaveAccessibleDescription(/Upload one in the Guided Workflow to export\./);
      fireEvent.click(exportButton);
      expect(client.exportSecurityPostman).not.toHaveBeenCalled();
    });

    it("keeps retained data readable and deletable, with the cookie limitation stated", async () => {
      renderPage("reports");
      expect(await screen.findAllByTestId("retained-row")).toHaveLength(2);
      expect(screen.getByTestId("retention-cookie-limitation")).toHaveTextContent("clearing cookies or using another browser or profile means this work can no longer be reached");
      expect(screen.getByRole("button", { name: "Delete the retained work of Orders API · orders.yaml" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Delete everything retained for this browser" })).toBeEnabled();
    });
  });
});
