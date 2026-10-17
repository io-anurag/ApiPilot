import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  const props = { active: true, workflow: null, performanceDraft: false, onSelect: vi.fn(), onOpen: vi.fn(), onOpenRun: vi.fn(), ...overrides };
  render(<HomePage {...props} />);
  return props;
}

const EMPTY_SOURCES = {
  "/api/external-collections": { status: 200, body: { uploadedCollections: [] } },
  "/api/chain-plans": { status: 200, body: { plans: [] } },
  "/api/user-scripts/runs": { status: 200, body: { runs: [] } },
  "/api/ai/status": AI,
};

describe("HomePage (AP-054 FR-018 to FR-021)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers the four workflows and the artifact entry points with their start-screen names", async () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    const props = renderHome();
    for (const title of ["Guided Workflow", "Import & Run Collection", "Performance", "Run k6 Script"]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Guided Workflow, for an OpenAPI specification" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Performance, for an OpenAPI specification" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import & Run Collection, for a Postman collection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run k6 Script, for a k6 script" })).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Performance" }));
    expect(props.onSelect).toHaveBeenCalledWith("performance");
    await screen.findByTestId("home-recent-runs-empty");
  });

  it("shows the four tiles in order, each named by its title and described by its sentence (FR-011)", () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    renderHome();
    const tiles = ["Guided Workflow", "Import & Run Collection", "Performance", "Run k6 Script"].map((name) => screen.getByRole("button", { name }));
    expect(tiles[0]).toHaveAccessibleDescription(/OpenAPI specification into reviewed API tests/);
    expect(tiles[2]).toHaveAccessibleDescription(/k6 load test/);
    for (let i = 0; i < tiles.length - 1; i += 1) {
      expect(tiles[i].compareDocumentPosition(tiles[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("opens the same workflow from an artifact choice as from its tile, and recommends only the guided workflow (SC-002)", () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    const props = renderHome();
    for (const [artifact, id] of [
      ["Guided Workflow, for an OpenAPI specification", "guided-workflow"],
      ["Import & Run Collection, for a Postman collection", "import-collection"],
      ["Run k6 Script, for a k6 script", "user-script"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: artifact }));
      expect(props.onSelect).toHaveBeenLastCalledWith(id);
    }
    expect(screen.getAllByText("Recommended")).toHaveLength(1);
    expect(within(screen.getByRole("button", { name: "Guided Workflow" })).getByText("Recommended")).toBeInTheDocument();
  });

  it("says a Performance draft is in progress, in words, and describes the tile with it", () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    renderHome({ performanceDraft: true });
    expect(screen.getByText("Draft in progress")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Performance" })).toHaveAccessibleDescription(/Draft in progress/);
    expect(screen.getByTestId("home-next-steps")).toHaveTextContent("Finish the draft load test");
  });

  it("shows no coverage number with no specification, and says what is needed", async () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    renderHome();
    await waitFor(() => expect(screen.getAllByText("Needs a specification from the Guided Workflow.").length).toBeGreaterThan(0));
    const tiles = screen.getAllByTestId("stat-tile");
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) expect(tile.textContent).not.toMatch(/\d/);
    expect(screen.getByTestId("home-methods")).toHaveTextContent("Needs a specification.");
  });

  it("shows the coverage figures, areas, methods and next steps from the snapshot", async () => {
    stub({ "/api/coverage": { status: 200, body: snapshot() }, ...EMPTY_SOURCES });
    const props = renderHome();
    const summary = await screen.findByTestId("home-summary");
    await waitFor(() => expect(summary).toHaveTextContent("100%"));
    expect(summary).toHaveTextContent("75%");
    expect(within(screen.getByTestId("home-methods")).getByText("POST")).toBeInTheDocument();
    const steps = screen.getByTestId("home-next-steps");
    fireEvent.click(within(steps).getByRole("link", { name: /Review 3 pending scenarios/ }));
    expect(props.onOpen).toHaveBeenCalledWith({ view: "guided", stage: "scenarioReview" });
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

  it("shows the AI provider's state and provider in words, never a model identifier", async () => {
    stub({ "/api/coverage": NO_SPEC, ...EMPTY_SOURCES });
    renderHome();
    const tile = await screen.findByTestId("home-ai-status");
    await waitFor(() => expect(tile).toHaveTextContent("Ready"));
    expect(tile).toHaveTextContent("Mock provider");
    expect(tile.textContent).not.toContain("secret");
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
