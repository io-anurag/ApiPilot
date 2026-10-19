import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TestGenerationWorkflow } from "@apipilot/shared-domain";
import { HomePage } from "../../../src/pages/HomePage";
import { snapshot } from "../apiCoverage/coverageFixtures";

type Reply = { status: number; body: unknown };

function stub(routes: Record<string, Reply | (() => Reply) | "reject">) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      const key = Object.keys(routes).find((candidate) => url.startsWith(candidate) || url.includes(candidate));
      if (!key) return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      const route = routes[key];
      if (route === "reject") return Promise.reject(new Error("down"));
      const reply = typeof route === "function" ? route() : route;
      return Promise.resolve({ ok: reply.status < 300, status: reply.status, json: () => Promise.resolve(reply.body) });
    }),
  );
  return calls;
}

const NO_SPEC: Reply = { status: 409, body: { error: "no_active_workflow", message: "There is no active specification." } };
const AI: Reply = {
  status: 200,
  body: { state: "ready", provider: "mock", reason: null, modelId: "secret/model", acceleratorRequested: false, acceleratorActive: false, updatedAt: "x", lastKnownReadiness: null, latestBenchmarkRun: null },
};

function renderHome(overrides: Partial<Parameters<typeof HomePage>[0]> = {}) {
  const props = { active: true, workflow: null, workflowReady: true, performanceDraft: false, shortcutHint: "Ctrl K", onSelect: vi.fn(), onOpen: vi.fn(), onOpenRun: vi.fn(), ...overrides };
  render(<HomePage {...props} />);
  return props;
}

const EMPTY_SOURCES = {
  "/api/external-collections": { status: 200, body: { uploadedCollections: [] } },
  "/api/chain-plans": { status: 200, body: { plans: [] } },
  "/api/user-scripts/runs": { status: 200, body: { runs: [] } },
  "/api/ai/status": AI,
};

const k6Run = (n: number) => ({ id: `k${n}`, status: "completed", startedAt: `2026-10-10T1${n}:00:00.000Z`, snapshot: { scriptId: `s${n}`, scriptName: `script-${n}.js` } });

describe("HomePage (AP-054 FR-018 to FR-021, amended by AP-058, redesigned by AP-059)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens with the welcome hero: Get started opens the recommended workflow and Learn more opens the Help dialog (FR-002)", () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    const props = renderHome();
    const hero = screen.getByTestId("home-hero");
    expect(within(hero).getByText("Welcome to ApiPilot")).toBeInTheDocument();
    expect(within(hero).getByRole("heading", { level: 2 })).toHaveTextContent("From API specification to executable tests with AI");
    fireEvent.click(within(hero).getByRole("button", { name: "Get started" }));
    expect(props.onSelect).toHaveBeenLastCalledWith("guided-workflow");
    expect(screen.queryByTestId("help-dialog")).not.toBeInTheDocument();
    fireEvent.click(within(hero).getByRole("button", { name: "Learn more" }));
    expect(screen.getByTestId("help-dialog")).toBeInTheDocument();
  });

  it("lays out the hero, three numbered steps, next steps, recent runs and the AI provider in order (FR-001)", async () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    renderHome();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "From API specification to executable tests with AI",
      "Start with the artifact you have",
      "Launch a test session",
      "Explore results and insights",
      "Next steps",
      "Recent runs",
      "AI provider",
    ]);
    await screen.findByTestId("home-recent-runs-empty");
  });

  describe("step 1, the artifact you have (FR-003)", () => {
    it("names what each choice starts and from what, so it is distinct from the step 2 tile", () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      const props = renderHome();
      const openapi = screen.getByRole("group", { name: "OpenAPI specification" });
      expect(within(openapi).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
        "Start Guided Workflow with an OpenAPI specification",
        "Start Performance with an OpenAPI specification",
      ]);
      fireEvent.click(within(openapi).getByRole("button", { name: "Start Performance with an OpenAPI specification" }));
      expect(props.onSelect).toHaveBeenLastCalledWith("performance");
      fireEvent.click(screen.getByRole("button", { name: "Start Import & Run Collection with a Postman collection" }));
      expect(props.onSelect).toHaveBeenLastCalledWith("import-collection");
      fireEvent.click(screen.getByRole("button", { name: "Start Run k6 Script with a k6 script" }));
      expect(props.onSelect).toHaveBeenLastCalledWith("user-script");
    });
  });

  describe("step 2, launch a test session (FR-004)", () => {
    it("offers the four workflows in sidebar order, each started by its tile", () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      const props = renderHome();
      const section = screen.getByRole("region", { name: "Launch a test session" });
      expect(within(section).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Guided Workflow", "Import & Run Collection", "Performance", "Run k6 Script"]);
      for (const [name, id] of [
        ["Guided Workflow", "guided-workflow"],
        ["Import & Run Collection", "import-collection"],
        ["Performance", "performance"],
        ["Run k6 Script", "user-script"],
      ] as const) {
        fireEvent.click(within(section).getByRole("button", { name }));
        expect(props.onSelect).toHaveBeenLastCalledWith(id);
      }
    });

    it("says Recommended once, and the Guided Workflow tile is described by it", () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      renderHome();
      expect(screen.getAllByText("Recommended")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Guided Workflow" })).toHaveAccessibleDescription(/OpenAPI specification into reviewed API tests.*Recommended/);
      expect(screen.getByRole("button", { name: "Performance" })).not.toHaveAccessibleDescription(/Recommended/);
    });

    it("describes each tile with its catalog sentence", () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      renderHome();
      expect(screen.getByRole("button", { name: "Performance" })).toHaveAccessibleDescription(/k6 load test/);
    });

    it("says a Performance draft is in progress, in words, and offers to pick it up", async () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      const props = renderHome({ performanceDraft: true });
      expect(screen.getByText("Draft in progress")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Performance" })).toHaveAccessibleDescription(/Draft in progress/);
      const resume = await screen.findByTestId("home-next-steps");
      expect(resume).toHaveTextContent("Finish the draft load test");
      fireEvent.click(within(resume).getByRole("link", { name: "Finish the draft load test" }));
      expect(props.onOpen).toHaveBeenCalledWith({ view: "performance" });
    });
  });

  describe("step 3 with no specification (FR-005)", () => {
    it("shows the four figures' meanings and one reason, never a number, a bar or a per-figure repeat", async () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      renderHome();
      const reason = await screen.findByText("Needs a specification from the Guided Workflow.");
      expect(screen.getAllByText("Needs a specification from the Guided Workflow.")).toHaveLength(1);
      expect(reason).not.toHaveAttribute("role", "alert");
      const summary = screen.getByTestId("home-summary");
      expect(within(summary).getAllByTestId("home-figure")).toHaveLength(4);
      expect(summary).toHaveTextContent("Requirements covered by generated scenarios.");
      expect(summary.textContent).not.toMatch(/\d/);
      expect(screen.queryByTestId("home-spec-context")).not.toBeInTheDocument();
      await screen.findByTestId("home-recent-runs-empty");
    });

    it("links to the results screens that the sidebar lists", () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      const props = renderHome();
      fireEvent.click(screen.getByRole("link", { name: "Coverage" }));
      expect(props.onOpen).toHaveBeenLastCalledWith({ view: "coverage" });
      fireEvent.click(screen.getByRole("link", { name: "Security Lab" }));
      expect(props.onOpen).toHaveBeenLastCalledWith({ view: "security" });
    });

    it("names a coverage failure as an alert instead of hiding it, and still offers every workflow", async () => {
      stub({ "/api/coverage": { status: 500, body: { error: "internal_error", message: "Coverage failed." } }, ...EMPTY_SOURCES });
      renderHome();
      expect(await screen.findByRole("alert")).toHaveTextContent("Coverage is unavailable: Coverage failed.");
      expect(screen.getByRole("button", { name: "Guided Workflow" })).toBeInTheDocument();
    });
  });

  describe("Next steps (FR-006)", () => {
    it("holds a loading state until the workflow has been read, so its content never flips", () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      renderHome({ workflowReady: false });
      expect(screen.getByRole("status", { name: "Loading next steps" })).toBeInTheDocument();
      expect(screen.queryByTestId("home-next-steps")).not.toBeInTheDocument();
    });

    it("says nothing is waiting, in words, when nothing is", async () => {
      stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
      renderHome();
      expect(await screen.findByTestId("home-next-steps")).toHaveTextContent("Nothing is waiting on you.");
      expect(screen.getByText(/all set!/)).toBeInTheDocument();
    });
  });

  describe("with a specification loaded", () => {
    it("fills each figure with its value, and offers the first next step as the one button", async () => {
      stub({ "/api/coverage": { status: 200, body: snapshot() }, ...EMPTY_SOURCES });
      const props = renderHome();
      const summary = await screen.findByTestId("home-summary");
      await waitFor(() => expect(summary).toHaveTextContent("100%"));
      expect(summary).toHaveTextContent("75%");
      expect(screen.getAllByTestId("home-figure")).toHaveLength(4);
      expect(screen.queryByTestId("home-summary-reason")).not.toBeInTheDocument();
      expect(screen.getByTestId("home-spec-context")).toHaveTextContent(/\d+ operations? · \d+ scenarios?/);
      const steps = screen.getByTestId("home-next-steps");
      fireEvent.click(within(steps).getByRole("link", { name: /Review 3 pending scenarios/ }));
      expect(props.onOpen).toHaveBeenCalledWith({ view: "guided", stage: "scenarioReview" });
    });

    it("names the specification from the workflow", async () => {
      stub({ "/api/coverage": { status: 200, body: snapshot() }, ...EMPTY_SOURCES });
      const workflow = { id: "wf-1", activeStageId: "apiReview", specificationFilename: "orders.yaml", apiModel: { info: { title: "Orders API" } }, stages: {} } as unknown as TestGenerationWorkflow;
      renderHome({ workflow });
      const context = await screen.findByTestId("home-spec-context");
      expect(context).toHaveTextContent("Orders API");
      await waitFor(() => expect(context).toHaveTextContent("orders.yaml"));
    });

    it("says coverage is loading in place of the figures' values while it loads, never zeros", () => {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
      const workflow = { id: "wf-1", activeStageId: "apiReview", specificationFilename: "orders.yaml", stages: {} } as unknown as TestGenerationWorkflow;
      renderHome({ workflow });
      expect(screen.getByTestId("home-summary-reason")).toHaveTextContent("Loading coverage…");
      expect(screen.getByTestId("home-summary").textContent).not.toMatch(/\d/);
    });

    it("says nothing is waiting once nothing is", async () => {
      const base = snapshot();
      const body = snapshot({ operationCounts: { ...base.operationCounts, withNoScenarios: 0, withFailures: 0 }, assertionOutcomes: { ...base.assertionOutcomes, failed: 0 }, context: { ...base.context, scenarioCounts: { ...base.context.scenarioCounts, pending: 0 } } });
      stub({ "/api/coverage": { status: 200, body }, ...EMPTY_SOURCES });
      renderHome();
      await screen.findByTestId("home-spec-context");
      await waitFor(() => expect(screen.getByTestId("home-next-steps")).toHaveTextContent("Nothing is waiting on you."));
    });
  });

  it("lists recent runs from all three workflows newest first, skipping and naming a source that fails", async () => {
    stub({
      "/api/coverage": NO_SPEC,
      "/api/external-collections/c1/execution/runs": {
        status: 200,
        body: { runs: [{ id: "i1", uploadedCollectionSetId: "c1", uploadedCollectionSnapshot: { name: "Orders collection", tier: "local" }, status: "completed", startedAt: "2026-10-10T10:00:00.000Z" }] },
      },
      "/api/external-collections": { status: 200, body: { uploadedCollections: [{ id: "c1", name: "Orders collection", createdAt: "2026-10-01T00:00:00.000Z" }] } },
      "/api/chain-plans": "reject",
      "/api/user-scripts/runs": {
        status: 200,
        body: { runs: [{ id: "k1", status: "in-progress", startedAt: "2026-10-10T12:00:00.000Z", snapshot: { scriptId: "s1", scriptName: "smoke.js" } }] },
      },
      "/api/ai/status": AI,
    });
    const props = renderHome();
    const card = await screen.findByTestId("home-recent-runs");
    await waitFor(() => expect(within(card).getAllByRole("listitem").length).toBeGreaterThanOrEqual(2));
    const names = within(card).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
    expect(names[0]).toBe("Open results of smoke.js, Run k6 Script, In progress");
    expect(names[1]).toBe("Open results of Orders collection, Import & Run Collection, Completed");
    expect(await screen.findByTestId("home-recent-runs-unreadable")).toHaveTextContent("Performance runs could not be read.");
    fireEvent.click(within(card).getByRole("button", { name: /smoke\.js/ }));
    expect(props.onOpenRun).toHaveBeenCalledWith(expect.objectContaining({ target: { workflow: "k6", ownerId: "s1", runId: "k1" } }));
  });

  it("shows the newest five runs and the rest on View all (FR-007)", async () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES, "/api/user-scripts/runs": { status: 200, body: { runs: [1, 2, 3, 4, 5, 6, 7].map(k6Run) } } });
    renderHome();
    const card = await screen.findByTestId("home-recent-runs");
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(5));
    expect(within(card).getAllByRole("button", { name: /^Open results of/ })[0]).toHaveAccessibleName(/script-7\.js/);
    const more = within(card).getByRole("button", { name: "View all 7 runs" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(within(card).getAllByRole("listitem")).toHaveLength(7);
    fireEvent.click(within(card).getByRole("button", { name: "Show fewer runs" }));
    expect(within(card).getAllByRole("listitem")).toHaveLength(5);
  });

  it("offers no View all when five or fewer runs exist", async () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES, "/api/user-scripts/runs": { status: 200, body: { runs: [k6Run(1)] } } });
    renderHome();
    const card = await screen.findByTestId("home-recent-runs");
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(1));
    expect(within(card).queryByRole("button", { name: /View all|Show fewer/ })).not.toBeInTheDocument();
  });

  it("shows the AI provider's state and provider in words, never a model identifier, and offers no control it cannot honour (FR-008)", async () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    renderHome();
    const card = await screen.findByTestId("home-ai-status");
    await waitFor(() => expect(card).toHaveTextContent("Ready"));
    expect(card).toHaveTextContent("Mock provider");
    expect(card.textContent).not.toContain("secret");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says AI status is unavailable when it cannot be read, and still renders everything else", async () => {
    stub({ "/api/coverage": "reject", "/api/external-collections": "reject", "/api/chain-plans": "reject", "/api/user-scripts/runs": "reject", "/api/ai/status": "reject" });
    renderHome();
    expect(await screen.findByText("AI status unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guided Workflow" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText(/Coverage is unavailable/).length).toBeGreaterThan(0));
    expect(await screen.findByTestId("home-recent-runs-unreadable")).toHaveTextContent("Import & Run Collection runs could not be read.");
  });

  it("issues no request while it is not the visible destination", async () => {
    const calls = stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    renderHome({ active: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toEqual([]);
  });
});
