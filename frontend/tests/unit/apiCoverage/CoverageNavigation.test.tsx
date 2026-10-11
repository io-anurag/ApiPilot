import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { App } from "../../../src/App";
import { ScenarioReviewStage } from "../../../src/components/ScenarioReviewStage";
import { RESULTS_VIEWS, isResultsView } from "../../../src/components/workflowCatalog";
import { WORKFLOW_SECTIONS } from "../../../src/components/sectionCatalog";
import { snapshot } from "./coverageFixtures";

/** Responses by URL; anything else is refused loudly so an unexpected call fails the test. */
function stubFetch(coverage: "snapshot" | "no-workflow" = "snapshot") {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const reply = (status: number, body: unknown) =>
      Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
    if (url.includes("/api/health")) return reply(200, { status: "ok", timestamp: "2026-10-10T12:00:00.000Z" });
    if (url.includes("/api/coverage")) {
      return coverage === "snapshot"
        ? reply(200, snapshot())
        : reply(409, { error: "no_active_workflow", message: "There is no active specification." });
    }
    if (url.includes("/api/test-generation-workflow")) return reply(204, null);
    if (url.includes("/api/external-collections")) return reply(200, { uploadedCollections: [] });
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const pressCtrlK = () => fireEvent.keyDown(document, { key: "k", ctrlKey: true });

async function openCoverageFromPalette(): Promise<void> {
  pressCtrlK();
  const palette = await screen.findByRole("dialog", { name: "Command palette" });
  fireEvent.click(within(palette).getByRole("option", { name: /API Test Coverage/ }));
}

describe("Coverage in the results section (AP-046)", () => {
  it("is a results view in the results section, not a start-screen workflow", () => {
    expect(RESULTS_VIEWS.map((v) => v.id)).toEqual(["coverage"]);
    expect(isResultsView("coverage")).toBe(true);
    expect(isResultsView("guided-workflow")).toBe(false);
    expect(WORKFLOW_SECTIONS.coverage).toBe("results");
  });

  it("is reachable from the command palette, with the tab menu and the Coverage view", async () => {
    stubFetch();
    render(<App />);
    await openCoverageFromPalette();
    expect(await screen.findByRole("heading", { name: "API Test Coverage" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Top-level views" });
    expect(within(nav).getByRole("button", { name: "Coverage" })).toHaveAttribute("aria-current", "page");
    await screen.findByTestId("spec-metrics");
    expect(document.querySelector("main")?.getAttribute("data-section")).toBe("results");
  });

  it("does not add Coverage as a start-screen card", () => {
    stubFetch();
    render(<App />);
    expect(screen.queryByRole("button", { name: "API Test Coverage" })).not.toBeInTheDocument();
  });

  it("explains a session without a specification instead of failing", async () => {
    stubFetch("no-workflow");
    render(<App />);
    await openCoverageFromPalette();
    expect(await screen.findByTestId("coverage-no-workflow")).toBeInTheDocument();
  });

  it("keeps its state while the user visits another view, and refreshes on return", async () => {
    const fetchMock = stubFetch();
    render(<App />);
    await openCoverageFromPalette();
    await screen.findByTestId("gaps-table");
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "POST" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("method=POST"))).toBe(true));
    const nav = screen.getByRole("navigation", { name: "Top-level views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Import & Run Collection" }));
    expect(screen.getByTestId("coverage-page").parentElement).toHaveAttribute("hidden");
    const callsBefore = fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/coverage")).length;
    fireEvent.click(within(nav).getByRole("button", { name: "Coverage" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/coverage")).length).toBeGreaterThan(callsBefore),
    );
    expect((screen.getByLabelText("Method") as HTMLSelectElement).value).toBe("POST");
  });

  it("leads back into the execution workflow", async () => {
    stubFetch();
    render(<App />);
    await openCoverageFromPalette();
    await screen.findByTestId("gaps-table");
    fireEvent.click(screen.getByRole("button", { name: "Go to Import & Run" }));
    const nav = screen.getByRole("navigation", { name: "Top-level views" });
    expect(within(nav).getByRole("button", { name: "Import & Run Collection" })).toHaveAttribute("aria-current", "page");
  });
});

describe("contextual links to Coverage", () => {
  function reviewWorkflow(): TestGenerationWorkflow {
    return {
      id: "wf-1",
      activeStageId: "scenarioReview",
      reviewWorkspace: {
        workspaceRevision: 0,
        scenarios: [],
        summary: { total: 0, pending: 0, accepted: 0, rejected: 0, requiresReview: 0 },
        policy: { originsRequiringReview: ["AI", "USER"] },
      },
    } as unknown as TestGenerationWorkflow;
  }

  it("scenario review offers a link to Coverage when one is available", () => {
    const onOpenCoverage = vi.fn();
    render(<ScenarioReviewStage workflow={reviewWorkflow()} onAdvanced={vi.fn()} onOpenCoverage={onOpenCoverage} />);
    fireEvent.click(screen.getByRole("button", { name: "View coverage" }));
    expect(onOpenCoverage).toHaveBeenCalledTimes(1);
  });

  it("scenario review shows no link where Coverage is not wired", () => {
    render(<ScenarioReviewStage workflow={reviewWorkflow()} onAdvanced={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "View coverage" })).not.toBeInTheDocument();
  });
});
