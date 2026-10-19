import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
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

function renderActive(ui: ReactElement) {
  return render(<ActiveViewContext.Provider value="security">{ui}</ActiveViewContext.Provider>);
}

const RISK = observation({ id: "r1", ruleId: "effective-security-public", classification: "potential-risk", operationKey: "POST /admin/users", elementPointer: "/operations/POST /admin/users/security" });
const INFO = observation({ id: "i1", classification: "informational" });
const CONTEXT = observation({ id: "c1", ruleId: "sensitive-operation", classification: "requires-context", operationKey: "GET /accounts/{id}", elementPointer: "/operations/GET /accounts/{id}/security" });
const UNMEASURABLE = observation({ id: "n1", ruleId: "effective-security-none-declared", classification: "not-measurable", operationKey: undefined, elementPointer: "/securitySchemes" });

beforeEach(() => {
  fetchAnalysis.mockReset();
  fetchCategories.mockReset();
  fetchOverview.mockReset();
  fetchOverview.mockResolvedValue({ ok: true, data: overview() });
  fetchCategories.mockResolvedValue({ ok: true, data: categoriesReply });
});

describe("OverviewArea: analysis (US1)", () => {
  it("shows a loading state, not an empty one, while the analysis is read", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof client.fetchAnalysis>>) => void;
    fetchAnalysis.mockReturnValue(new Promise((r) => (resolve = r)));
    renderActive(<OverviewArea />);
    expect(screen.getByRole("status", { name: "Analyzing the specification" })).toBeInTheDocument();
    expect(screen.queryByTestId("security-analysis-empty")).not.toBeInTheDocument();
    resolve({ ok: true, data: analysisReply([INFO]) });
    expect(await screen.findByTestId("security-overview")).toBeInTheDocument();
  });

  it("says specification analysis cannot prove a runtime vulnerability, and that findings come only from runs", async () => {
    fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([INFO]) });
    renderActive(<OverviewArea />);
    const note = await screen.findByTestId("security-reading-note");
    expect(note).toHaveTextContent(/cannot prove what the running API does/);
    expect(note).toHaveTextContent(/Findings come only from running approved tests/);
  });

  it("counts observations by the four classifications, with their full names", async () => {
    fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([RISK, INFO, CONTEXT, UNMEASURABLE, observation({ id: "i2" })]) });
    renderActive(<OverviewArea />);
    const tiles = await screen.findAllByTestId("stat-tile");
    const byLabel = Object.fromEntries(tiles.map((tile) => [within(tile).getByText(/^(Informational observation|Potential risk|Requires additional context|Not measurable)$/).textContent, tile.querySelector("dd")?.textContent]));
    expect(byLabel).toEqual({
      "Informational observation": "2",
      "Potential risk": "1",
      "Requires additional context": "1",
      "Not measurable": "1",
    });
  });

  it("puts potential risks in their own group, labelled as specification analysis with no run behind it", async () => {
    fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([RISK, INFO, CONTEXT]) });
    renderActive(<OverviewArea />);
    const heading = await screen.findByRole("heading", { name: "Potential risks (specification analysis)" });
    const card = heading.closest("section")!;
    expect(within(card).getByText(/Evidence basis: the specification only\. Nothing has been sent to any target\./)).toBeInTheDocument();
    const rows = within(card).getAllByTestId("observation-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("data-rule", "effective-security-public");
    // The other observations are a separate group.
    const others = screen.getByRole("heading", { name: "Other observations" }).closest("section")!;
    expect(within(others).getAllByTestId("observation-row")).toHaveLength(2);
  });

  it("filters the other observations by classification without touching the risks", async () => {
    fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([RISK, INFO, CONTEXT, UNMEASURABLE]) });
    renderActive(<OverviewArea />);
    await screen.findByTestId("security-overview");
    const others = screen.getByRole("heading", { name: "Other observations" }).closest("section")!;
    fireEvent.change(within(others).getByLabelText("Show"), { target: { value: "requires-context" } });
    expect(within(others).getAllByTestId("observation-row")).toHaveLength(1);
    expect(within(others).getByText("Requires additional context", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Potential risks (specification analysis)" }).closest("section")!.querySelectorAll("[data-testid=observation-row]")).toHaveLength(1);
  });

  it("states the scope as every operation, and what could not be measured", async () => {
    fetchAnalysis.mockResolvedValue({
      ok: true,
      data: analysisReply([UNMEASURABLE], { operationCount: 50, analysis: { ...analysisReply([UNMEASURABLE]).analysis, unmeasurable: ["authentication scheme declarations"] } }),
    });
    renderActive(<OverviewArea />);
    expect(await screen.findByTestId("security-analysis-scope")).toHaveTextContent(
      "Analysis covers all 50 operations in the specification. Not measurable with this input: authentication scheme declarations.",
    );
  });

  it("says plainly when no potential risk was raised", async () => {
    fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([INFO]) });
    renderActive(<OverviewArea />);
    expect(await screen.findByTestId("security-risk-list-empty")).toHaveTextContent("The analysis raised no potential risks for this specification.");
  });

  it("shows the categories with their support levels beside the analysis", async () => {
    fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([INFO]) });
    renderActive(<OverviewArea />);
    expect(await screen.findByRole("heading", { name: "Categories and support levels" })).toBeInTheDocument();
    expect(screen.getAllByTestId("category-row")).toHaveLength(4);
  });

  it("distinguishes a missing specification from an error and from an empty result", async () => {
    fetchAnalysis.mockResolvedValue({ ok: false, error: "no_specification", message: "No specification is loaded.", status: 409, details: {} });
    renderActive(<OverviewArea />);
    const empty = await screen.findByTestId("security-analysis-empty");
    expect(empty).toHaveTextContent("There is no analysis to show yet.");
    expect(empty).toHaveTextContent(/needs a specification/);
    expect(screen.queryByTestId("security-analysis-error")).not.toBeInTheDocument();
    // The registry does not depend on a specification, so it is still shown.
    expect(await screen.findByRole("heading", { name: "Categories and support levels" })).toBeInTheDocument();
  });

  it("shows an error as an error, with a retry that asks again, and never as an empty result", async () => {
    fetchAnalysis.mockResolvedValueOnce({ ok: false, error: "network_error", message: "unreachable", status: 0, details: {} });
    renderActive(<OverviewArea />);
    const error = await screen.findByTestId("security-analysis-error");
    expect(error).toHaveTextContent("The security analysis is unavailable");
    expect(error).toHaveTextContent("This is not an empty result.");
    fetchAnalysis.mockResolvedValueOnce({ ok: true, data: analysisReply([INFO]) });
    fireEvent.click(within(error).getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("security-overview")).toBeInTheDocument();
    expect(fetchAnalysis).toHaveBeenCalledTimes(2);
  });

  it("keeps the last analysis on screen when a refresh fails, and says it is out of date", async () => {
    fetchAnalysis.mockResolvedValueOnce({ ok: true, data: analysisReply([INFO]) });
    renderActive(<OverviewArea />);
    await screen.findByTestId("security-overview");
    fetchAnalysis.mockResolvedValueOnce({ ok: false, error: "network_error", message: "gone", status: 0, details: {} });
    // The settings editor refreshes the analysis after a save; force one directly through its Save path.
    fireEvent.change(screen.getByLabelText("Sensitive field names"), { target: { value: "ssn" } });
    vi.mocked(client.saveSettings).mockResolvedValue({ ok: true, data: { sensitiveFields: ["ssn"] } });
    fireEvent.click(screen.getByRole("button", { name: "Save field names" }));
    const stale = await screen.findByTestId("security-analysis-stale");
    expect(stale).toHaveTextContent("Out-of-date analysis");
    expect(screen.getByTestId("security-overview")).toBeInTheDocument();
  });

  it("re-reads the analysis after the configured sensitive fields are saved", async () => {
    fetchAnalysis.mockResolvedValue({ ok: true, data: analysisReply([INFO]) });
    vi.mocked(client.saveSettings).mockResolvedValue({ ok: true, data: { sensitiveFields: ["ssn"] } });
    renderActive(<OverviewArea />);
    await screen.findByTestId("security-overview");
    expect(fetchAnalysis).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Sensitive field names"), { target: { value: "ssn" } });
    fireEvent.click(screen.getByRole("button", { name: "Save field names" }));
    await waitFor(() => expect(fetchAnalysis).toHaveBeenCalledTimes(2));
  });

  it("does not read anything while another destination is shown", () => {
    render(
      <ActiveViewContext.Provider value="home">
        <OverviewArea />
      </ActiveViewContext.Provider>,
    );
    expect(fetchAnalysis).not.toHaveBeenCalled();
  });
});
