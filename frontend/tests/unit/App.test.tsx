import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../../src/App";

/** The sidebar, as a Testing Library scope: links in it are the destinations (AP-054). */
function sidebar() {
  return within(screen.getByRole("navigation", { name: "Primary" }));
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ status: "ok", timestamp: "2026-08-26T12:00:00.000Z" }),
        });
      }
      if (url.includes("/api/test-generation-workflow")) {
        return Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.resolve(null),
        });
      }
      if (url.includes("/api/external-collections")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ uploadedCollections: [] }),
        });
      }
      if (url.includes("/api/coverage")) {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: "no_active_workflow", message: "none" }) });
      }
      if (url.includes("/api/ai/status")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ state: "ready", provider: "mock", reason: null }) });
      }
      if (url.includes("/api/user-scripts/runs")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) });
      }
      if (url.includes("/api/chain-plans")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ plans: [] }) });
      }
      if (url.includes("/performance/runs") || url.includes("/api/collection-performance/runs") || url.includes("/api/quick-performance/runs")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ runs: [] }) });
      }
      if (url.includes("/api/quick-performance")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: "quick_test_not_found", message: "none" }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }),
  );
}

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a connected status once the health check succeeds", async () => {
    stubFetch();

    render(<App />);

    expect(screen.getByText("ApiPilot")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("connection-status")).toHaveTextContent("Connected"),
    );
  });

  it("shows an unreachable status when the health check fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health"))
          return Promise.reject(new Error("network error"));
        return Promise.resolve({
          ok: true,
          status: 204,
          json: () => Promise.resolve(null),
        });
      }),
    );

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId("connection-status")).toHaveTextContent("Disconnected"),
    );
  });

  it("opens on Home inside the shell: a sidebar and a header, no tab menu (AP-054 FR-001)", async () => {
    stubFetch();

    render(<App />);

    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Top-level views" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to start/ })).not.toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("picking Guided Workflow shows the upload prompt and marks it in the sidebar (FR-017)", async () => {
    stubFetch();

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));

    expect(await screen.findByLabelText("Upload OpenAPI specification")).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Guided Workflow" })).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toMatch(/^#\/guided/);
  });

  it("Home is one click from the guided workflow, which keeps its state (AP-054 FR-005)", async () => {
    stubFetch();

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));
    await screen.findByLabelText("Upload OpenAPI specification");

    fireEvent.click(sidebar().getByRole("link", { name: "Home" }));
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(screen.getByTestId("test-generation-workflow-page")).not.toBeVisible();

    fireEvent.click(sidebar().getByRole("link", { name: "Guided Workflow" }));
    expect(await screen.findByLabelText("Upload OpenAPI specification")).toBeVisible();
  });

  it("opens 'Import & Run Collection' from the sidebar with no prior OpenAPI upload (FR-011, research.md D9)", async () => {
    stubFetch();

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Import & Run Collection" }));

    expect(await screen.findByText("Import a Postman collection")).toBeInTheDocument();
    expect(screen.getByTestId("external-collection-upload")).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Import & Run Collection" })).toHaveAttribute("aria-current", "page");

    // Switching to the guided workflow and back preserves the other page's state rather than remounting it.
    fireEvent.click(sidebar().getByRole("link", { name: "Guided Workflow" }));
    expect(await screen.findByLabelText("Upload OpenAPI specification")).toBeInTheDocument();
  });

  it("keeps Import & Run Collection mounted across Home: returning to it makes no second request (AP-054 stay-mounted)", async () => {
    stubFetch();

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Import & Run Collection" }));
    expect(await screen.findByText("Import a Postman collection")).toBeInTheDocument();
    const externalCollectionFetches = () =>
      vi.mocked(fetch).mock.calls.filter(([input]) => input.toString().includes("/api/external-collections")).length;
    await waitFor(() => expect(externalCollectionFetches()).toBeGreaterThan(0));

    // Home reads the collections' runs for Recent runs; that is its own read, so let it settle first.
    fireEvent.click(sidebar().getByRole("link", { name: "Home" }));
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("home-recent-runs-empty")).toBeInTheDocument());
    const fetchesBefore = externalCollectionFetches();

    fireEvent.click(sidebar().getByRole("link", { name: "Import & Run Collection" }));

    expect(await screen.findByText("Import a Postman collection")).toBeVisible();
    // Not remounted: its uploaded-collections list is not fetched a second time.
    expect(externalCollectionFetches()).toBe(fetchesBefore);
  });

  it("reads Home's figures once per visit and nothing while another destination is shown (AP-054 FR-019)", async () => {
    stubFetch();
    render(<App />);
    await screen.findByTestId("home-page");
    const aiReads = () => vi.mocked(fetch).mock.calls.filter(([input]) => input.toString().includes("/api/ai/status")).length;
    await waitFor(() => expect(aiReads()).toBe(1));

    fireEvent.click(sidebar().getByRole("link", { name: "Performance" }));
    await screen.findByRole("heading", { name: "Turn what you have into a load test" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(aiReads()).toBe(1);

    fireEvent.click(sidebar().getByRole("link", { name: "Home" }));
    await waitFor(() => expect(aiReads()).toBe(2));
  });

  it("offers Performance next to Import & Run Collection, with its one-sentence statement (AP-047 FR-001)", async () => {
    stubFetch();
    render(<App />);
    const quick = await screen.findByRole("button", { name: "Performance" });
    expect(quick).toHaveTextContent(
      "Turn a specification, a guided workflow or a collection into a k6 load test: pick a source, review the plan, set the load and run.",
    );
    expect(screen.queryByRole("button", { name: "Quick performance test" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Performance plans" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import & Run Collection" })).toBeInTheDocument();

    fireEvent.click(quick);
    expect(await screen.findByRole("heading", { name: "Turn what you have into a load test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /OpenAPI specification/ })).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Performance" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(sidebar().getByRole("link", { name: "Home" }));
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
  });

  it("keeps an unfinished Performance test across other destinations and Home, and says so on Home (AP-047 FR-019, FR-021)", async () => {
    stubFetch();
    render(<App />);
    expect(screen.queryByText("Draft in progress")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Performance" }));
    fireEvent.click(await screen.findByRole("button", { name: /OpenAPI specification/ }));
    const path = await screen.findByTestId("performance-path");
    expect(path).toBeVisible();

    // Another destination and back: the path is where it was left.
    fireEvent.click(sidebar().getByRole("link", { name: "Import & Run Collection" }));
    await waitFor(() => expect(screen.getByTestId("performance-path")).not.toBeVisible());
    fireEvent.click(sidebar().getByRole("link", { name: "Performance" }));
    expect(screen.getByTestId("performance-path")).toBeVisible();

    // Home: the Performance card says a draft is in progress, and choosing it again resumes the same path.
    fireEvent.click(sidebar().getByRole("link", { name: "Home" }));
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Performance" })).toHaveAccessibleDescription(/Draft in progress/);
    expect(screen.getByText("Draft in progress")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Performance" }));
    expect(screen.getByTestId("performance-path")).toBeVisible();
    expect(screen.getByTestId("performance-step-source")).toHaveTextContent("Source");
  });

  it("returning to 'Guided Workflow' resumes it instead of silently handing off to Import & Run Collection again (regression)", async () => {
    const postmanArtifact = {
      collection: { info: { name: "c" }, item: [] },
      environment: { values: [] },
      readme: "readme text",
      summary: { requestCount: 0, folderCount: 0, byProvenance: { RULE: 0, AI: 0 } },
      limitations: [],
    };
    const stageIds = [
      "upload",
      "analysis",
      "apiReview",
      "deterministicGeneration",
      "aiEnhancement",
      "scenarioReview",
      "dependencyAnalysis",
      "workflowReview",
      "postmanGeneration",
      "execution",
    ] as const;
    const stages = Object.fromEntries(
      stageIds.map((id) => [
        id,
        { stageId: id, status: id === "execution" ? "active" : "complete" },
      ]),
    );
    const executionWorkflow = {
      id: "wf-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeStageId: "execution",
      stages,
      specificationFilename: "valid.yaml",
      apiModel: {
        operations: [],
        securitySchemes: {},
        summary: {
          operationCount: 0,
          schemaCount: 0,
          securitySchemeCount: 0,
          issues: [],
        },
      },
      postmanArtifact,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/health")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ status: "ok", timestamp: "2026-08-26T12:00:00.000Z" }),
          });
        }
        if (url.includes("/api/test-generation-workflow")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ workflow: executionWorkflow }),
          });
        }
        if (url.includes("/api/external-collections")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ uploadedCollections: [] }),
          });
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    render(<App />);

    // Resuming directly onto the already-generated "execution" stage auto-hands-off once, as
    // intended (e.g. after a real page reload) — this is the FIRST handoff, not the regression.
    fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));
    await waitFor(() =>
      expect(sidebar().getByRole("link", { name: "Import & Run Collection" })).toHaveAttribute("aria-current", "page"),
    );

    // Back to the guided workflow through the sidebar: it must show its own view, not silently
    // hand off to "Import & Run Collection" a second time.
    fireEvent.click(sidebar().getByRole("link", { name: "Guided Workflow" }));

    expect(await screen.findByTestId("execution-handoff-notice")).toBeInTheDocument();
    expect(sidebar().getByRole("link", { name: "Guided Workflow" })).toHaveAttribute("aria-current", "page");
  });

  describe("addresses (AP-054 FR-029)", () => {
    it("gives each destination its own address and follows Back and Forward", async () => {
      stubFetch();
      render(<App />);
      await screen.findByTestId("home-page");
      expect(window.location.hash).toBe("");

      fireEvent.click(sidebar().getByRole("link", { name: "Performance" }));
      expect(window.location.hash).toBe("#/performance");
      fireEvent.click(sidebar().getByRole("link", { name: "Run k6 Script" }));
      expect(window.location.hash).toBe("#/k6");
      fireEvent.click(sidebar().getByRole("link", { name: "Coverage" }));
      expect(window.location.hash).toBe("#/coverage");
      expect(sidebar().getByRole("link", { name: "Coverage" })).toHaveAttribute("aria-current", "page");

      act(() => {
        window.history.back();
      });
      await waitFor(() => expect(sidebar().getByRole("link", { name: "Run k6 Script" })).toHaveAttribute("aria-current", "page"));
      act(() => {
        window.history.back();
      });
      await waitFor(() => expect(sidebar().getByRole("link", { name: "Performance" })).toHaveAttribute("aria-current", "page"));
      act(() => {
        window.history.forward();
      });
      await waitFor(() => expect(sidebar().getByRole("link", { name: "Run k6 Script" })).toHaveAttribute("aria-current", "page"));
    });

    it("opens the destination named by the address on load, and leaves the query string alone", async () => {
      stubFetch();
      window.history.replaceState(null, "", "/?token=abc#/k6");
      render(<App />);
      await waitFor(() => expect(sidebar().getByRole("link", { name: "Run k6 Script" })).toHaveAttribute("aria-current", "page"));
      expect(window.location.search).toBe("?token=abc");
      fireEvent.click(sidebar().getByRole("link", { name: "Coverage" }));
      expect(window.location.search).toBe("?token=abc");
      expect(window.location.hash).toBe("#/coverage");
    });

    it("shows Home with a notice for an address that matches nothing, never a blank page", async () => {
      stubFetch();
      window.history.replaceState(null, "", "/#/nonsense");
      render(<App />);
      expect(await screen.findByTestId("home-page")).toBeInTheDocument();
      expect(screen.getByTestId("route-notice")).toHaveTextContent(/does not match a screen/);
      expect(window.location.hash).toBe("#/");
      fireEvent.click(sidebar().getByRole("link", { name: "Performance" }));
      expect(screen.getByTestId("route-notice")).toBeEmptyDOMElement();
    });

    it("opens the guided workflow at Upload, with a notice, for a stage address with no workflow behind it", async () => {
      stubFetch();
      window.history.replaceState(null, "", "/#/guided/scenarioReview");
      render(<App />);
      expect(await screen.findByLabelText("Upload OpenAPI specification")).toBeVisible();
      expect(screen.getByTestId("route-notice")).toHaveTextContent(/no workflow in progress/);
      expect(window.location.hash).toBe("#/guided");
    });
  });

  it("lists the guided stages in the sidebar, locked ones unavailable and saying why (AP-054 FR-003)", async () => {
    stubFetch();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));
    await screen.findByLabelText("Upload OpenAPI specification");

    const nav = sidebar();
    expect(nav.getByRole("link", { name: /Upload/ })).toHaveAttribute("aria-current", "step");
    const locked = nav.getByTestId("sidebar-stage-scenarioReview");
    expect(locked).toHaveAttribute("aria-disabled", "true");
    expect(locked.tagName).toBe("BUTTON");
    expect(locked).toHaveAccessibleDescription("Upload a specification first");
    expect(nav.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Prepare",
      "Design",
      "Organize",
      "Execute",
    ]);
  });

  describe("command palette (AP-038 US3)", () => {
    const pressCtrlK = (target: Element | Document = document) =>
      fireEvent.keyDown(target, { key: "k", ctrlKey: true });

    it("opens with Ctrl+K on Home, without Go to Home, and opens a workflow like its card", async () => {
      stubFetch();
      render(<App />);
      await screen.findByTestId("home-page");

      pressCtrlK();
      const palette = await screen.findByRole("dialog", { name: "Command palette" });
      expect(
        within(palette).queryByRole("option", { name: /Go to Home/ }),
      ).not.toBeInTheDocument();

      fireEvent.click(
        within(palette).getByRole("option", { name: /Import & Run Collection/ }),
      );
      expect(await screen.findByText("Import a Postman collection")).toBeInTheDocument();
      expect(sidebar().getByRole("link", { name: "Import & Run Collection" })).toHaveAttribute("aria-current", "page");
      expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();

      pressCtrlK();
      fireEvent.click(await screen.findByRole("option", { name: /Go to Home/ }));
      expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    });

    it("also opens from the header button", async () => {
      stubFetch();
      render(<App />);
      fireEvent.click(
        await screen.findByRole("button", { name: "Open command palette" }),
      );
      expect(await screen.findByTestId("command-palette")).toBeInTheDocument();
    });

    it("leaves Ctrl+K alone in a text field and while another dialog is open (FR-018)", async () => {
      stubFetch();
      render(<App />);
      await screen.findByTestId("home-page");

      const field = document.createElement("input");
      document.body.appendChild(field);
      pressCtrlK(field);
      expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
      field.remove();

      fireEvent.click(
        screen.getByRole("button", { name: "Keyboard shortcuts and help" }),
      );
      await screen.findByTestId("help-dialog");
      pressCtrlK();
      expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
    });

    it("switches and remembers the theme exactly like the header control (FR-019)", async () => {
      stubFetch();
      window.localStorage.setItem("apipilot-theme", "light");
      render(<App />);
      await screen.findByTestId("home-page");

      pressCtrlK();
      fireEvent.click(
        await screen.findByRole("option", { name: /Switch to dark theme/ }),
      );
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(window.localStorage.getItem("apipilot-theme")).toBe("dark");
      expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      window.localStorage.removeItem("apipilot-theme");
    });

    it("from the guided workflow, opens another workflow as its card would and keeps the run (FR-019)", async () => {
      stubFetch();
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Guided Workflow" }));
      await screen.findByLabelText("Upload OpenAPI specification");

      pressCtrlK();
      fireEvent.click(
        await screen.findByRole("option", { name: /^Performance/ }),
      );
      expect(await screen.findByRole("heading", { name: "Turn what you have into a load test" })).toBeInTheDocument();
      expect(sidebar().getByRole("link", { name: "Performance" })).toHaveAttribute("aria-current", "page");

      fireEvent.click(sidebar().getByRole("link", { name: "Guided Workflow" }));
      expect(await screen.findByLabelText("Upload OpenAPI specification")).toBeVisible();
    });
  });

});
